import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { useAuth, useData } from "@/context/AppContext";
import { useToastBanner } from "@/context/ToastBannerContext";

// B9: a gentle, batched heads-up that new photos landed in the user's squad
// vaults. Foreground-only and throttled to once every 6 hours so it never
// nags. The uploader is excluded (you don't get pinged about your own photos),
// and the very first check per squad just establishes a baseline so launching
// the feature doesn't replay the entire backlog.
const THROTTLE_MS = 6 * 60 * 60 * 1000;

type VaultPhoto = { createdAt: string; uploaderId: string };

export function useNewVaultPhotosBanner(): void {
  const { authToken, currentUser, isLoggedIn } = useAuth();
  const { squads, squadsLoading } = useData();
  const { showBanner } = useToastBanner();
  const router = useRouter();

  const runningRef = useRef(false);
  const squadsRef = useRef(squads);
  squadsRef.current = squads;
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = authToken;

  const run = useCallback(async () => {
    const token = tokenRef.current;
    const userId = currentUser?.id;
    if (!token || !userId || userId === "me" || runningRef.current) return;
    // Nothing to check yet — bail WITHOUT burning the throttle so the run
    // re-fires once the user's squads finish loading.
    if (squadsRef.current.length === 0) return;
    runningRef.current = true;
    try {
      const throttleKey = `vaultbanner_lastrun_${userId}`;
      const last = Number((await AsyncStorage.getItem(throttleKey)) ?? 0) || 0;
      if (Date.now() - last < THROTTLE_MS) return;

      let totalNew = 0;
      let squadsWithNew = 0;
      let sample: { id: string; name: string; emoji: string } | null = null;

      for (const squad of squadsRef.current) {
        const seenKey = `vaultseen_${squad.id}_${userId}`;
        const stored = await AsyncStorage.getItem(seenKey);
        // First time we ever look at this squad → baseline, never replay history.
        if (stored === null) {
          await AsyncStorage.setItem(seenKey, String(Date.now()));
          continue;
        }
        const seenAt = Number(stored) || 0;

        let photos: VaultPhoto[] = [];
        try {
          const res = await fetch(`${API_BASE}/api/vault/photos?squadId=${squad.id}`, {
            headers: buildAuthHeaders(token),
          });
          if (!res.ok) continue;
          const data = (await res.json()) as { photos?: VaultPhoto[] };
          photos = data.photos ?? [];
        } catch {
          continue;
        }

        const fresh = photos.filter((p) => {
          const t = new Date(p.createdAt).getTime();
          return Number.isFinite(t) && t > seenAt && p.uploaderId !== userId;
        });
        await AsyncStorage.setItem(seenKey, String(Date.now()));
        if (fresh.length > 0) {
          totalNew += fresh.length;
          squadsWithNew += 1;
          if (!sample) sample = { id: squad.id, name: squad.name, emoji: squad.emoji };
        }
      }

      await AsyncStorage.setItem(throttleKey, String(Date.now()));

      if (totalNew > 0 && sample) {
        const single = squadsWithNew === 1;
        const subtitle = single
          ? `${totalNew} new ${totalNew === 1 ? "photo" : "photos"} in ${sample.emoji} ${sample.name}`
          : `${totalNew} new photos across ${squadsWithNew} squads`;
        const targetSquadId = sample.id;
        showBanner({
          title: "New squad memories 📸",
          subtitle,
          emoji: "📸",
          onPress: single
            ? () => router.push(`/squad/${targetSquadId}`)
            : () => router.push("/vault"),
        });
      }
    } finally {
      runningRef.current = false;
    }
  }, [currentUser?.id, showBanner, router]);

  useEffect(() => {
    if (!isLoggedIn || !authToken || squadsLoading) return;
    void run();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void run();
    });
    return () => sub.remove();
  }, [isLoggedIn, authToken, squadsLoading, run]);
}
