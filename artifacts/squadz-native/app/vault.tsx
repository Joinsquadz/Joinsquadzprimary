import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Alert,
  Modal,
  Animated,
  AppState,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useColors } from "@/hooks/useColors";
import { useSquadStream } from "@/hooks/useSquadStream";
import { useAuth, useData } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { UpgradeModal } from "@/components/UpgradeModal";
import AttachmentVideo from "@/components/AttachmentVideo";
import VaultMediaDetail, { type VaultDetailPhoto } from "@/components/VaultMediaDetail";
import VaultShareComposer, { type VaultShareTarget } from "@/components/VaultShareComposer";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

const VAULT_SELECTED_KEY = "vault:selectedPhoto";
const VAULT_SCROLL_KEY = "vault:scrollY";

// Hard cap on a single uploaded file: 150 MB. Photos and videos share this
// limit; the server enforces the same ceiling on the request-url route.
const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

type MediaType = "image" | "video";
type MediaFilter = "all" | MediaType;

type VaultPhoto = {
  id: number;
  eventId: string | null;
  squadId: string | null;
  uploadedAt: string;
  url: string;
  uploaderId: string;
  mediaType?: MediaType;
  eventTitle: string | null;
  eventEmoji: string | null;
  squadName: string | null;
  favorited?: boolean;
  caption?: string | null;
  heartCount?: number;
  hearted?: boolean;
  commentCount?: number;
};

interface SquadVaultPhoto {
  id: number;
  url: string;
  eventId?: string | null;
  uploaderId: string;
  uploadedAt: string;
  mediaType?: MediaType;
  favorited?: boolean;
  uploaderFirstName?: string | null;
  uploaderLastName?: string | null;
  uploaderImageUrl?: string | null;
  caption?: string | null;
  heartCount?: number;
  hearted?: boolean;
  commentCount?: number;
}

// Group a photo's upload date into a stable month bucket ("2026-05") and a human
// label ("May 2026"), used by the personal-vault "By Date" filter.
const monthKey = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
};
const monthLabel = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

function VaultImage({ uri, style, headers }: { uri: string; style: object; headers?: Record<string, string> }) {
  const colors = useColors();
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const shimmer = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    setStatus("loading");
  }, [uri]);

  useEffect(() => {
    if (status !== "loading") return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [status, shimmer]);

  return (
    <View style={style}>
      {status !== "error" && (
        <Image
          source={{ uri, headers }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={uri}
          transition={200}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
        />
      )}
      {status === "loading" && (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.card, opacity: shimmer }]}
        />
      )}
      {status === "error" && (
        <View style={[StyleSheet.absoluteFill, styles.fallbackCell]}>
          <LinearGradient
            colors={["#2A2A38", "#1A1A26"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <BlurView intensity={18} tint="dark" style={StyleSheet.absoluteFill} />
          <Ionicons name="image-outline" size={22} color={colors.mutedForeground} />
        </View>
      )}
    </View>
  );
}

export default function VaultScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { authToken, currentUser } = useAuth();
  const currentUserId = currentUser?.id ?? null;
  const { events } = useData();
  const [isPro, setIsPro] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [photos, setPhotos] = useState<VaultPhoto[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadingSquad, setIsUploadingSquad] = useState(false);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [uploadEventId, setUploadEventId] = useState<string>("");
  const [activeSquad, setActiveSquad] = useState<string>("all");
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  const { showToast } = useToast();

  // Personal vault (no squadId): "My Uploads" vs "Favorites" sub-section, the
  // combinable By-Date filter, and the per-user favorites set/collection.
  const [personalTab, setPersonalTab] = useState<"uploads" | "favorites">("uploads");
  const [dateFilter, setDateFilter] = useState<string | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set());
  const [favoritePhotos, setFavoritePhotos] = useState<VaultPhoto[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(false);

  // Squad vault state (only used when squadId is present)
  const [squadPhotos, setSquadPhotos] = useState<SquadVaultPhoto[]>([]);
  const [squadLoading, setSquadLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPhotos, setPickerPhotos] = useState<VaultPhoto[]>([]);
  const [pickerSelected, setPickerSelected] = useState<Set<number>>(new Set());
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerRequiresPro, setPickerRequiresPro] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  const eventsById = useMemo(() => {
    const map = new Map<string, (typeof events)[number]>();
    for (const e of events) map.set(e.id, e);
    return map;
  }, [events]);

  // The personal-vault grid draws from My Uploads (photos) or Favorites
  // (favoritePhotos) depending on the active sub-section.
  const personalSource = personalTab === "favorites" ? favoritePhotos : photos;

  const squadNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of personalSource) {
      if (p.squadName && !seen.has(p.squadName)) {
        seen.add(p.squadName);
        out.push(p.squadName);
      }
    }
    return out;
  }, [personalSource]);

  // Month buckets present in the active personal dataset, newest first — drives
  // the "By Date" dropdown.
  const monthOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of personalSource) {
      const key = monthKey(p.uploadedAt);
      if (key && !seen.has(key)) seen.set(key, monthLabel(p.uploadedAt));
    }
    return Array.from(seen.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [personalSource]);

  const initialized = useRef(false);
  const scrollRef = useRef<FlatList<VaultPhoto>>(null);
  const scrollYRef = useRef(0);
  const saveScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { squadId, squadName, eventId, eventName } = useLocalSearchParams<{
    squadId?: string;
    squadName?: string;
    eventId?: string;
    eventName?: string;
  }>();

  const isContextual = !!(squadId || eventId);
  const isSquadVault = !!squadId;

  const recentEvents = useMemo(
    () => (squadId ? events.filter(e => e.squadId === squadId) : events),
    [events, squadId],
  );

  useEffect(() => {
    if (eventId) setUploadEventId(eventId);
  }, [eventId]);

  const visiblePhotos = useMemo(() => {
    let list = activeSquad === "all" ? personalSource : personalSource.filter(p => p.squadName === activeSquad);
    if (mediaFilter !== "all") {
      list = list.filter(p => (p.mediaType ?? "image") === mediaFilter);
    }
    if (dateFilter) {
      list = list.filter(p => monthKey(p.uploadedAt) === dateFilter);
    }
    return list;
  }, [personalSource, activeSquad, mediaFilter, dateFilter]);

  const filteredSquadPhotos = useMemo(() => {
    if (mediaFilter === "all") return squadPhotos;
    return squadPhotos.filter(p => (p.mediaType ?? "image") === mediaFilter);
  }, [squadPhotos, mediaFilter]);

  const filterLabel = eventName
    ? decodeURIComponent(eventName)
    : squadName
    ? decodeURIComponent(squadName)
    : null;

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  // Restore scroll position and selected photo from AsyncStorage on mount
  useEffect(() => {
    if (isContextual) {
      initialized.current = true;
      return;
    }
    Promise.all([
      AsyncStorage.getItem(VAULT_SELECTED_KEY),
      AsyncStorage.getItem(VAULT_SCROLL_KEY),
    ]).then(([savedSelected, savedScroll]) => {
      if (savedSelected) {
        const id = parseInt(savedSelected, 10);
        if (!isNaN(id)) setSelected(id);
      }
      initialized.current = true;

      if (savedScroll) {
        const y = parseFloat(savedScroll);
        if (!isNaN(y) && y > 0) {
          setTimeout(() => {
            scrollRef.current?.scrollToOffset({ offset: y, animated: false });
          }, 100);
        }
      }
    });
  }, [isContextual]);

  // Persist selected photo ID
  useEffect(() => {
    if (!initialized.current || isContextual) return;
    if (selected === null) {
      AsyncStorage.removeItem(VAULT_SELECTED_KEY);
    } else {
      AsyncStorage.setItem(VAULT_SELECTED_KEY, String(selected));
    }
  }, [selected, isContextual]);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (isContextual) return;
    scrollYRef.current = e.nativeEvent.contentOffset.y;
    if (saveScrollTimer.current) clearTimeout(saveScrollTimer.current);
    saveScrollTimer.current = setTimeout(() => {
      AsyncStorage.setItem(VAULT_SCROLL_KEY, String(scrollYRef.current));
    }, 300);
  }, [isContextual]);

  const [upgradeModalVisible, setUpgradeModalVisible] = useState(false);

  const authHeaders = useCallback((): HeadersInit => {
    return buildAuthHeaders(authToken);
  }, [authToken]);

  // Reconcile the local favorites set with a freshly-fetched dataset. Only the
  // ids present in `items` are touched, so favorites known from other surfaces
  // (squad vault, favorites tab) are preserved.
  const syncFavorites = useCallback((items: { id: number; favorited?: boolean }[]) => {
    setFavoriteIds(prev => {
      const next = new Set(prev);
      for (const it of items) {
        if (it.favorited) next.add(it.id);
        else next.delete(it.id);
      }
      return next;
    });
  }, []);

  const checkSubscription = useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch(`${API_BASE}/api/subscription`, { headers: authHeaders(), credentials: "include" });
      if (!r.ok) { setIsPro(false); return false; }
      const d = await r.json() as { isPro?: boolean };
      const pro = !!d.isPro;
      setIsPro(pro);
      return pro;
    } catch {
      setIsPro(false);
      return false;
    }
  }, [authHeaders]);

  useEffect(() => {
    void checkSubscription();
  }, [checkSubscription]);

  const fetchPhotos = useCallback(async () => {
    const params = new URLSearchParams();
    if (squadId) params.set("squadId", squadId as string);
    else if (eventId) params.set("eventId", eventId as string);

    setPhotosLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/vault/photos?${params.toString()}`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json() as { photos: VaultPhoto[]; isPro?: boolean };
      setPhotos(data.photos ?? []);
      syncFavorites(data.photos ?? []);
      if (data.isPro !== undefined) setIsPro(data.isPro);
    } catch {
      // silently fail
    } finally {
      setPhotosLoading(false);
    }
  }, [authToken, squadId, eventId, authHeaders, syncFavorites]);

  // Personal Favorites sub-section — everything the user bookmarked across all
  // squads. Favorites are a Squadz+ feature; free users hit the entrance gate
  // before this view renders, so this only runs for subscribers.
  const fetchFavorites = useCallback(async () => {
    setFavoritesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/vault/favorites`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json() as { photos: VaultPhoto[]; isPro?: boolean };
      setFavoritePhotos(data.photos ?? []);
      syncFavorites(data.photos ?? []);
      if (data.isPro !== undefined) setIsPro(data.isPro);
    } catch {
      // silently fail
    } finally {
      setFavoritesLoading(false);
    }
  }, [authHeaders, syncFavorites]);

  // Optimistically bookmark / un-bookmark a photo or video. Favorites are
  // private and never notify; the toggle reverts on any server error.
  const toggleFavorite = useCallback(async (photoId: number) => {
    const wasFav = favoriteIds.has(photoId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFavoriteIds(prev => {
      const next = new Set(prev);
      if (wasFav) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
    try {
      const res = wasFav
        ? await fetch(`${API_BASE}/api/vault/favorites/${photoId}`, { method: "DELETE", headers: authHeaders() })
        : await fetch(`${API_BASE}/api/vault/favorites`, {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ photoId }),
          });
      if (!res.ok) throw new Error("favorite failed");
      // When un-favoriting from the Favorites tab, drop it from that collection
      // so the grid reflects the change without a refetch.
      if (wasFav) setFavoritePhotos(prev => prev.filter(p => p.id !== photoId));
    } catch {
      setFavoriteIds(prev => {
        const next = new Set(prev);
        if (wasFav) next.add(photoId);
        else next.delete(photoId);
        return next;
      });
      showToast("Couldn't update favorite. Please try again.", { durationMs: 2500 });
    }
  }, [favoriteIds, authHeaders, showToast]);

  useEffect(() => {
    if (isPro !== null) fetchPhotos();
  }, [isPro, fetchPhotos]);

  // Load the Favorites collection the first time (and whenever) the user opens
  // that sub-section in the personal vault.
  useEffect(() => {
    if (!isSquadVault && personalTab === "favorites") void fetchFavorites();
  }, [isSquadVault, personalTab, fetchFavorites]);

  // Keep Pro status and photos fresh whenever the app returns to the foreground
  // (e.g. after completing the Stripe checkout the shared UpgradeModal launches).
  // The UpgradeModal owns the post-checkout confirmation polling now.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void (async () => {
        await checkSubscription();
        await fetchPhotos();
      })();
    });
    return () => sub.remove();
  }, [checkSubscription, fetchPhotos]);

  const imageUrl = (objectPath: string) => `${API_BASE}/api/storage${objectPath}`;

  // Open the library for both photos AND videos. No duration cap — uploads are
  // bounded by file SIZE (150 MB), enforced per-asset in uploadAsset below.
  const pickVaultMedia = useCallback(async (): Promise<ImagePicker.ImagePickerAsset[] | null> => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow photo library access to upload to your vault.");
      return null;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets.length) return null;
    return result.assets;
  }, []);

  // Upload a single picked asset: request a signed URL, PUT the bytes directly
  // to cloud storage with the CORRECT content-type (videos were previously sent
  // as image/jpeg), then record the vault item. Throws an explicit, human
  // readable Error on any failure so the caller can surface it (no silent skip).
  const uploadAsset = useCallback(
    async (asset: ImagePicker.ImagePickerAsset, extra: Record<string, unknown>): Promise<void> => {
      const isVideo = asset.type === "video";
      const contentType = asset.mimeType ?? (isVideo ? "video/mp4" : "image/jpeg");
      const mediaType: MediaType = isVideo ? "video" : "image";
      const name = asset.fileName ?? (isVideo ? "video.mp4" : "photo.jpg");
      const size = asset.fileSize ?? 0;

      if (size > MAX_UPLOAD_BYTES) {
        throw new Error(`"${name}" is larger than 150 MB and can't be uploaded.`);
      }

      const urlRes = await fetch(`${API_BASE}/api/storage/uploads/request-url`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name, size, contentType }),
      });
      if (!urlRes.ok) {
        const body = (await urlRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Couldn't start the upload. Please try again.");
      }
      const { uploadURL, objectPath } = (await urlRes.json()) as { uploadURL: string; objectPath: string };

      const fileRes = await fetch(asset.uri);
      const blob = await fileRes.blob();
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": contentType },
      });
      if (!putRes.ok) {
        throw new Error("Couldn't upload the file to storage. Please try again.");
      }

      const createRes = await fetch(`${API_BASE}/api/vault/photos`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ url: objectPath, mediaType, ...extra }),
      });
      if (!createRes.ok) {
        const body = (await createRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Couldn't save to the vault. Please try again.");
      }
    },
    [authHeaders],
  );

  const handleUpload = useCallback(async () => {
    const assets = await pickVaultMedia();
    if (!assets) return;

    setIsUploading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const failures: string[] = [];
    for (const asset of assets) {
      try {
        await uploadAsset(
          asset,
          uploadEventId || eventId ? { eventId: uploadEventId || eventId } : {},
        );
      } catch (e) {
        failures.push(e instanceof Error ? e.message : "Upload failed.");
      }
    }

    await fetchPhotos();
    setIsUploading(false);

    if (failures.length > 0) {
      Alert.alert(
        failures.length === assets.length ? "Upload failed" : "Some uploads failed",
        failures.join("\n\n"),
      );
    }
  }, [pickVaultMedia, uploadAsset, fetchPhotos, uploadEventId, eventId]);

  const fetchSquadVault = useCallback(async () => {
    if (!squadId) return;
    setSquadLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/squads/${squadId}/vault`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json() as { photos: SquadVaultPhoto[] };
      setSquadPhotos(data.photos ?? []);
      syncFavorites(data.photos ?? []);
    } catch {
      // silently fail
    } finally {
      setSquadLoading(false);
    }
  }, [squadId, authHeaders, syncFavorites]);

  // T11 — Upload photos/videos straight into the current squad's vault (no event
  // roll-up needed). The server authorizes by squad membership and marks each
  // item sharedToSquad=true.
  const handleUploadToSquad = useCallback(async () => {
    if (!squadId) return;
    const assets = await pickVaultMedia();
    if (!assets) return;

    setIsUploadingSquad(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const failures: string[] = [];
    for (const asset of assets) {
      try {
        await uploadAsset(asset, { squadId });
      } catch (e) {
        failures.push(e instanceof Error ? e.message : "Upload failed.");
      }
    }

    await fetchSquadVault();
    setIsUploadingSquad(false);

    if (failures.length > 0) {
      Alert.alert(
        failures.length === assets.length ? "Upload failed" : "Some uploads failed",
        failures.join("\n\n"),
      );
    }
  }, [squadId, pickVaultMedia, uploadAsset, fetchSquadVault]);

  useEffect(() => {
    if (squadId) fetchSquadVault();
  }, [squadId, fetchSquadVault]);

  // Live updates: when any member shares or removes a vault photo, the server
  // broadcasts a squad update over SSE so the gallery reflects it immediately
  // instead of waiting for the next focus/AppState refetch.
  useSquadStream({
    squadId: squadId ?? null,
    authToken,
    onUpdate: () => { void fetchSquadVault(); },
  });

  const openPicker = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPickerSelected(new Set());
    setPickerRequiresPro(false);
    setPickerPhotos([]);
    setPickerOpen(true);
    setPickerLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/vault/photos`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json() as { photos: VaultPhoto[]; isPro?: boolean; requiresPro?: boolean };
      // The personal roll-up is Squadz+ only — free users get an entrance gate
      // here too (they can still upload directly to the squad vault for free).
      if (data.requiresPro) {
        setPickerRequiresPro(true);
        return;
      }
      setPickerPhotos((data.photos ?? []).filter(p => !!p.url));
    } catch {
      // silently fail
    } finally {
      setPickerLoading(false);
    }
  }, [authHeaders]);

  const togglePick = useCallback((id: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPickerSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleShare = useCallback(async () => {
    if (!squadId || pickerSelected.size === 0) return;
    setIsSharing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await fetch(`${API_BASE}/api/squads/${squadId}/vault`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds: Array.from(pickerSelected) }),
      });
      if (res.ok) {
        await fetchSquadVault();
        setPickerOpen(false);
        setPickerSelected(new Set());
      }
    } catch {
      Alert.alert("Couldn't share", "Could not roll up photos. Please try again.");
    } finally {
      setIsSharing(false);
    }
  }, [squadId, pickerSelected, authHeaders, fetchSquadVault]);

  const handleRemoveShared = useCallback(async (photoId: number) => {
    if (!squadId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await fetch(`${API_BASE}/api/squads/${squadId}/vault/${photoId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (res.ok || res.status === 204) {
        setSelected(null);
        await fetchSquadVault();
      }
    } catch {
      Alert.alert("Couldn't remove", "Could not remove the photo. Please try again.");
    }
  }, [squadId, authHeaders, fetchSquadVault]);

  const selectedPhoto = visiblePhotos.find(p => p.id === selected) ?? null;
  const selectedSquadPhoto = squadPhotos.find(p => p.id === selected) ?? null;

  const [shareTarget, setShareTarget] = useState<VaultShareTarget | null>(null);

  // Normalize whichever photo is selected (personal or squad) into the shape the
  // full-screen detail view renders.
  const detailPhoto = useMemo<VaultDetailPhoto | null>(() => {
    if (selectedSquadPhoto) {
      const p = selectedSquadPhoto;
      const name = [p.uploaderFirstName, p.uploaderLastName].filter(Boolean).join(" ").trim() || "Squad member";
      return {
        id: p.id,
        url: p.url,
        mediaType: p.mediaType,
        uploaderId: p.uploaderId,
        uploadedAt: p.uploadedAt,
        caption: p.caption ?? null,
        heartCount: p.heartCount,
        hearted: p.hearted,
        commentCount: p.commentCount,
        title: name,
        subtitle: new Date(p.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      };
    }
    if (selectedPhoto) {
      const p = selectedPhoto;
      return {
        id: p.id,
        url: p.url,
        mediaType: p.mediaType,
        uploaderId: p.uploaderId,
        uploadedAt: p.uploadedAt,
        caption: p.caption ?? null,
        heartCount: p.heartCount,
        hearted: p.hearted,
        commentCount: p.commentCount,
        title: p.eventTitle ? `${p.eventEmoji ?? "🎉"} ${p.eventTitle}` : "Vault photo",
        subtitle: `${p.squadName ? `${p.squadName} · ` : ""}${new Date(p.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
      };
    }
    return null;
  }, [selectedPhoto, selectedSquadPhoto]);

  // Reflect a caption edit from the detail view back into the grid datasets so
  // the change is visible without a full refetch.
  const handleCaptionUpdated = useCallback((id: number, caption: string | null) => {
    setPhotos(prev => prev.map(p => p.id === id ? { ...p, caption } : p));
    setFavoritePhotos(prev => prev.map(p => p.id === id ? { ...p, caption } : p));
    setSquadPhotos(prev => prev.map(p => p.id === id ? { ...p, caption } : p));
  }, []);

  // FlatLists re-render their cells when this reference changes — favoriteIds is
  // a fresh Set on every toggle, so the bookmark icons stay in sync.
  const listExtra = useMemo(() => ({ selected, favoriteIds }), [selected, favoriteIds]);

  const uploaderName = (p: SquadVaultPhoto): string => {
    const name = [p.uploaderFirstName, p.uploaderLastName].filter(Boolean).join(" ").trim();
    return name || "Squad member";
  };

  const uploaderInitial = (p: SquadVaultPhoto): string => {
    const base = p.uploaderFirstName || p.uploaderLastName || "?";
    return base.slice(0, 1).toUpperCase();
  };

  const shortDate = (iso: string): string => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  // Bookmark overlay for a grid cell. Stops the cell's own press so tapping the
  // bookmark only toggles the favorite (never opens/selects the item).
  const renderFavButton = (id: number) => {
    const fav = favoriteIds.has(id);
    return (
      <TouchableOpacity
        onPress={() => toggleFavorite(id)}
        style={styles.favBtn}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.7}
        accessibilityLabel={fav ? "Remove from favorites" : "Add to favorites"}
      >
        <Ionicons name={fav ? "bookmark" : "bookmark-outline"} size={15} color={fav ? colors.gold : "#fff"} />
      </TouchableOpacity>
    );
  };

  // Render a grid cell's media: videos use the web-safe AttachmentVideo player,
  // photos keep the lightweight VaultImage.
  const renderCellMedia = (url: string, isVideo: boolean) =>
    isVideo ? (
      <AttachmentVideo uri={imageUrl(url)} style={styles.gridImage} headers={authHeaders() as Record<string, string>} />
    ) : (
      <VaultImage uri={imageUrl(url)} style={styles.gridImage} headers={authHeaders() as Record<string, string>} />
    );

  // T13a — All / Photos / Videos filter tabs, shared by the personal and squad grids.
  const mediaFilterTabs = (
    <View style={styles.mediaFilterRow}>
      {(["all", "image", "video"] as const).map(f => {
        const active = mediaFilter === f;
        const label = f === "all" ? "All" : f === "image" ? "Photos" : "Videos";
        return (
          <TouchableOpacity
            key={f}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMediaFilter(f); setSelected(null); }}
            style={[styles.mediaFilterTab, { backgroundColor: active ? colors.primary : colors.card, borderColor: active ? colors.primary : colors.border }]}
            activeOpacity={0.8}
          >
            <Text style={[styles.mediaFilterText, { color: active ? "#fff" : colors.mutedForeground }]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 16, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.back();
          }}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.foreground }]}>📷 Photo Vault</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {filterLabel ? filterLabel : "Private squad memories"}
          </Text>
        </View>
        {isPro && (
          <View style={[styles.proBadge, { backgroundColor: colors.gold + "22", borderColor: colors.gold + "60" }]}>
            <Text style={[styles.proBadgeText, { color: colors.gold }]}>PRO</Text>
          </View>
        )}
      </View>

      {isSquadVault ? (
        <FlatList
          data={squadLoading && squadPhotos.length === 0 ? [] : filteredSquadPhotos}
          keyExtractor={(p) => String(p.id)}
          numColumns={3}
          columnWrapperStyle={{ gap: 4 }}
          ItemSeparatorComponent={() => <View style={{ height: 4 }} />}
          extraData={listExtra}
          contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 24 }]}
          showsVerticalScrollIndicator={false}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={11}
          removeClippedSubviews={Platform.OS !== "web"}
          ListHeaderComponent={
            <>
              {mediaFilterTabs}
              <Text style={[styles.countLabel, { color: colors.mutedForeground }]}>
                {filteredSquadPhotos.length} {filteredSquadPhotos.length === 1 ? "item" : "items"} · curated by your squad
              </Text>
            </>
          }
          ListEmptyComponent={
            squadLoading ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.primary} size="large" />
              </View>
            ) : (
              <View style={[styles.emptyState, { borderColor: colors.border }]}>
                <Text style={styles.emptyIcon}>📸</Text>
                <Text style={[styles.emptyTitle, { color: colors.mutedForeground }]}>No photos rolled up yet</Text>
                <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Roll up your best photos to start the squad vault</Text>
              </View>
            )
          }
          renderItem={({ item: p }) => (
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelected(selected === p.id ? null : p.id); }}
              style={[styles.gridCell, { borderWidth: 2, borderColor: selected === p.id ? colors.primary : "transparent" }]}
              activeOpacity={0.8}
            >
              {renderCellMedia(p.url, p.mediaType === "video")}
              {renderFavButton(p.id)}
              <View style={styles.attrOverlay}>
                <View style={[styles.attrAvatar, { backgroundColor: colors.primary }]}>
                  <Text style={styles.attrAvatarText}>{uploaderInitial(p)}</Text>
                </View>
                <Text style={styles.attrText} numberOfLines={1}>
                  {(p.uploaderFirstName || uploaderName(p)).split(" ")[0]} · {shortDate(p.uploadedAt)}
                </Text>
              </View>
              {selected === p.id && (
                <View style={[styles.checkBadge, { backgroundColor: colors.primary }]}>
                  <Ionicons name="checkmark" size={10} color="#fff" />
                </View>
              )}
            </TouchableOpacity>
          )}
          ListFooterComponent={
            <View style={{ marginTop: 16 }}>
              <TouchableOpacity
                style={[styles.uploadBtn, { borderColor: colors.border, marginBottom: 12 }]}
                activeOpacity={0.7}
                onPress={handleUploadToSquad}
                disabled={isUploadingSquad}
              >
                {isUploadingSquad ? (
                  <ActivityIndicator color={colors.mutedForeground} />
                ) : (
                  <Ionicons name="cloud-upload-outline" size={26} color={colors.mutedForeground} />
                )}
                <Text style={[styles.uploadLabel, { color: colors.mutedForeground }]}>
                  {isUploadingSquad ? "Uploading…" : "Upload to this vault"}
                </Text>
                <Text style={[styles.uploadSub, { color: colors.mutedForeground }]}>
                  Add photos or videos straight to the squad vault
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.rollUpBtn, { backgroundColor: colors.primary }]}
                activeOpacity={0.85}
                onPress={openPicker}
              >
                <Ionicons name="sparkles" size={18} color="#fff" />
                <Text style={styles.rollUpBtnText}>Roll up your best photos</Text>
              </TouchableOpacity>
            </View>
          }
        />
      ) : isPro === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (!isContextual && !isPro) ? (
        <View style={[styles.center, { paddingHorizontal: 32 }]}>
          <Text style={styles.gateEmoji}>🔒</Text>
          <Text style={[styles.gateTitle, { color: colors.foreground }]}>Your personal vault</Text>
          <Text style={[styles.gateBody, { color: colors.mutedForeground }]}>
            Your personal vault is a Squadz+ feature. Upgrade to access all your uploads in one place, save favorites from any squad, and keep your memories forever.
          </Text>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setUpgradeModalVisible(true); }}
            style={[styles.upgradeBtn, { backgroundColor: colors.primary, alignSelf: "stretch" }]}
            activeOpacity={0.85}
          >
            <Text style={styles.upgradeBtnText}>⚡ Upgrade to Squadz+ — $29.99/year</Text>
          </TouchableOpacity>
        </View>
      ) : (
        (personalTab === "favorites" ? favoritesLoading : photosLoading) ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : (
          <FlatList
            ref={scrollRef}
            data={visiblePhotos}
            keyExtractor={(p) => String(p.id)}
            numColumns={3}
            columnWrapperStyle={{ gap: 4 }}
            ItemSeparatorComponent={() => <View style={{ height: 4 }} />}
            extraData={listExtra}
            contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 24 }]}
            showsVerticalScrollIndicator={false}
            onScroll={handleScroll}
            scrollEventThrottle={100}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={11}
            removeClippedSubviews={Platform.OS !== "web"}
            ListHeaderComponent={
              <>
              {filterLabel && (
                <View style={[styles.filterBadge, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "40" }]}>
                  <Ionicons name={eventId ? "calendar-outline" : "people-outline"} size={14} color={colors.primary} />
                  <Text style={[styles.filterBadgeText, { color: colors.primary }]}>{filterLabel}</Text>
                  <TouchableOpacity onPress={() => router.replace("/vault" as never)}>
                    <Ionicons name="close" size={14} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              )}

              {!isContextual && (
                <View style={[styles.segmented, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {(["uploads", "favorites"] as const).map(tab => {
                    const active = personalTab === tab;
                    return (
                      <TouchableOpacity
                        key={tab}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setPersonalTab(tab);
                          setSelected(null);
                          setActiveSquad("all");
                          setDateFilter(null);
                        }}
                        style={[styles.segmentedBtn, active && { backgroundColor: colors.primary }]}
                        activeOpacity={0.8}
                      >
                        <Ionicons
                          name={tab === "favorites" ? "bookmark" : "images-outline"}
                          size={15}
                          color={active ? "#fff" : colors.mutedForeground}
                        />
                        <Text style={[styles.segmentedText, { color: active ? "#fff" : colors.mutedForeground }]}>
                          {tab === "favorites" ? "Favorites" : "My Uploads"}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {mediaFilterTabs}

              {!isContextual && monthOptions.length > 0 && (
                <View style={styles.dateFilterRow}>
                  <TouchableOpacity
                    style={[styles.dateBtn, { backgroundColor: dateFilter ? colors.primary : colors.card, borderColor: dateFilter ? colors.primary : colors.border }]}
                    activeOpacity={0.7}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDatePickerOpen(o => !o); }}
                  >
                    <Ionicons name="calendar-outline" size={14} color={dateFilter ? "#fff" : colors.mutedForeground} />
                    <Text style={[styles.dateBtnText, { color: dateFilter ? "#fff" : colors.mutedForeground }]} numberOfLines={1}>
                      {dateFilter ? (monthOptions.find(([k]) => k === dateFilter)?.[1] ?? "By Date") : "By Date"}
                    </Text>
                    <Ionicons name={datePickerOpen ? "chevron-up" : "chevron-down"} size={14} color={dateFilter ? "#fff" : colors.mutedForeground} />
                  </TouchableOpacity>
                  {dateFilter && (
                    <TouchableOpacity
                      style={[styles.dateClearBtn, { borderColor: colors.border }]}
                      activeOpacity={0.7}
                      onPress={() => { setDateFilter(null); setDatePickerOpen(false); }}
                    >
                      <Ionicons name="close" size={14} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {!isContextual && datePickerOpen && monthOptions.length > 0 && (
                <View style={[styles.pickerList, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 12 }]}>
                  {monthOptions.map(([key, label]) => (
                    <TouchableOpacity
                      key={key}
                      style={[styles.pickerItem, { borderTopColor: colors.border, borderTopWidth: 1 }]}
                      activeOpacity={0.7}
                      onPress={() => { setDateFilter(key); setDatePickerOpen(false); setSelected(null); }}
                    >
                      <Text style={[styles.pickerItemText, { color: dateFilter === key ? colors.primary : colors.foreground }]}>{label}</Text>
                      {dateFilter === key && <Ionicons name="checkmark" size={16} color={colors.primary} />}
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={[styles.countLabel, { color: colors.mutedForeground }]}>
                {visiblePhotos.length} {visiblePhotos.length === 1 ? "item" : "items"} · tap to view
              </Text>

              {!isContextual && squadNames.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  {["all", ...squadNames].map(squad => {
                    const isActive = activeSquad === squad;
                    return (
                      <TouchableOpacity
                        key={squad}
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setActiveSquad(squad); setSelected(null); }}
                        style={[styles.chip, { backgroundColor: isActive ? colors.primary : colors.card, borderColor: isActive ? colors.primary : colors.border }]}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.chipText, { color: isActive ? "#fff" : colors.mutedForeground }]}>
                          {squad === "all" ? "All" : squad}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </>
            }
            ListEmptyComponent={
              personalTab === "favorites" ? (
                <View style={[styles.emptyState, { borderColor: colors.border }]}>
                  <Text style={styles.emptyIcon}>🔖</Text>
                  <Text style={[styles.emptyTitle, { color: colors.mutedForeground }]}>No favorites yet</Text>
                  <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                    Tap the bookmark on any photo or video to save it here.
                  </Text>
                </View>
              ) : (
                <View style={[styles.emptyState, { borderColor: colors.border }]}>
                  <Text style={styles.emptyIcon}>📷</Text>
                  <Text style={[styles.emptyTitle, { color: colors.mutedForeground }]}>
                    {activeSquad === "all" ? "No photos yet" : `No photos for ${activeSquad}`}
                  </Text>
                  <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                    {activeSquad !== "all"
                      ? "Try another squad or upload below"
                      : filterLabel
                        ? `No photos uploaded to ${filterLabel} yet.`
                        : isPro
                          ? "Upload your first squad memory below"
                          : "Photos from your squadz will show up here"}
                  </Text>
                </View>
              )
            }
            renderItem={({ item: p }) => (
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  // In the Favorites tab a photo belongs to a squad vault — tap
                  // opens it in that squad's context; otherwise just select it.
                  if (personalTab === "favorites" && p.squadId) {
                    router.push({ pathname: "/vault", params: { squadId: p.squadId, squadName: p.squadName ?? "Squad" } } as never);
                    return;
                  }
                  setSelected(selected === p.id ? null : p.id);
                }}
                style={[styles.gridCell, { borderWidth: 2, borderColor: selected === p.id ? colors.primary : "transparent" }]}
                activeOpacity={0.8}
              >
                {renderCellMedia(p.url, p.mediaType === "video")}
                {renderFavButton(p.id)}
                {selected === p.id && (
                  <View style={[styles.checkBadge, { backgroundColor: colors.primary }]}>
                    <Ionicons name="checkmark" size={10} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>
            )}
            ListFooterComponent={
              <View style={{ marginTop: 16 }}>
              {personalTab === "uploads" && (
                <>
                  {isPro && recentEvents.length > 0 && (
                    <View style={styles.pickerWrap}>
                      <Text style={[styles.pickerLabel, { color: colors.mutedForeground }]}>Add to event (optional)</Text>
                      <TouchableOpacity
                        style={[styles.pickerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                        activeOpacity={0.7}
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setEventPickerOpen(o => !o); }}
                        disabled={isUploading}
                      >
                        <Text style={[styles.pickerBtnText, { color: uploadEventId ? colors.foreground : colors.mutedForeground }]} numberOfLines={1}>
                          {uploadEventId ? `${eventsById.get(uploadEventId)?.emoji ?? "🎉"} ${eventsById.get(uploadEventId)?.title ?? "Selected event"}` : "No event"}
                        </Text>
                        <Ionicons name={eventPickerOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} />
                      </TouchableOpacity>
                      {eventPickerOpen && (
                        <View style={[styles.pickerList, { backgroundColor: colors.card, borderColor: colors.border }]}>
                          <TouchableOpacity
                            style={styles.pickerItem}
                            activeOpacity={0.7}
                            onPress={() => { setUploadEventId(""); setEventPickerOpen(false); }}
                          >
                            <Text style={[styles.pickerItemText, { color: colors.mutedForeground }]}>No event</Text>
                          </TouchableOpacity>
                          {recentEvents.map(ev => (
                            <TouchableOpacity
                              key={ev.id}
                              style={[styles.pickerItem, { borderTopColor: colors.border, borderTopWidth: 1 }]}
                              activeOpacity={0.7}
                              onPress={() => { setUploadEventId(ev.id); setEventPickerOpen(false); }}
                            >
                              <Text style={[styles.pickerItemText, { color: colors.foreground }]} numberOfLines={1}>
                                {ev.emoji} {ev.title}
                              </Text>
                              <Text style={[styles.pickerItemSub, { color: colors.mutedForeground }]}>{ev.squadName}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>
                  )}

                  <TouchableOpacity
                    style={[styles.uploadBtn, { borderColor: colors.border }]}
                    activeOpacity={0.7}
                    onPress={handleUpload}
                    disabled={isUploading}
                  >
                    {isUploading ? (
                      <ActivityIndicator color={colors.mutedForeground} />
                    ) : (
                      <Ionicons name="add" size={28} color={colors.mutedForeground} />
                    )}
                    <Text style={[styles.uploadLabel, { color: colors.mutedForeground }]}>
                      {isUploading ? "Uploading…" : "Upload photos"}
                    </Text>
                    <Text style={[styles.uploadSub, { color: colors.mutedForeground }]}>
                      {uploadEventId
                        ? `Tagging to ${eventsById.get(uploadEventId)?.title ?? "selected event"}`
                        : "Add memories from your last event"}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          }
        />
        )
      )}

      <UpgradeModal
        visible={upgradeModalVisible}
        trigger="photos"
        onClose={() => setUpgradeModalVisible(false)}
        onUpgradeSuccess={() => {
          setIsPro(true);
          void fetchPhotos();
          showToast("Welcome to Squadz+! Your full vault is unlocked.", { durationMs: 4000 });
        }}
      />

      <VaultMediaDetail
        visible={detailPhoto !== null}
        photo={detailPhoto}
        authToken={authToken}
        currentUserId={currentUserId ?? null}
        favorited={detailPhoto ? favoriteIds.has(detailPhoto.id) : false}
        onClose={() => setSelected(null)}
        onToggleFavorite={(id) => { void toggleFavorite(id); }}
        onShare={(p) => setShareTarget({ id: p.id, url: p.url, mediaType: p.mediaType })}
        onCaptionUpdated={handleCaptionUpdated}
        onDelete={selectedSquadPhoto && currentUserId && selectedSquadPhoto.uploaderId === currentUserId
          ? (id) => handleRemoveShared(id)
          : undefined}
        deleteLabel="Remove from squad vault"
      />

      <VaultShareComposer
        visible={shareTarget !== null}
        target={shareTarget}
        authToken={authToken}
        onClose={() => setShareTarget(null)}
      />

      <Modal
        visible={pickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: colors.background, borderColor: colors.border, paddingBottom: botPad + 16 }]}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderText}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Roll up your best photos</Text>
                <Text style={[styles.modalSubtitle, { color: colors.mutedForeground }]}>Pick from your photos to share with the squad</Text>
              </View>
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPickerOpen(false); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={24} color={colors.foreground} />
              </TouchableOpacity>
            </View>

            {pickerLoading ? (
              <View style={styles.modalCenter}>
                <ActivityIndicator color={colors.primary} size="large" />
              </View>
            ) : pickerRequiresPro ? (
              <View style={styles.modalCenter}>
                <View style={[styles.proHint, { backgroundColor: colors.gold + "18", borderColor: colors.gold + "40" }]}>
                  <Text style={styles.proHintIcon}>⚡</Text>
                  <Text style={[styles.proHintText, { color: colors.gold }]}>Upgrade to Squadz+ to roll up photos</Text>
                </View>
                <TouchableOpacity
                  onPress={() => { setPickerOpen(false); setUpgradeModalVisible(true); }}
                  style={[styles.upgradeBtn, { backgroundColor: colors.primary, marginTop: 16 }]}
                  activeOpacity={0.85}
                >
                  <Text style={styles.upgradeBtnText}>⚡ Upgrade to Squadz+ — $29.99/year</Text>
                </TouchableOpacity>
              </View>
            ) : pickerPhotos.length > 0 ? (
              <ScrollView
                contentContainerStyle={styles.modalScroll}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.grid}>
                  {pickerPhotos.map(p => {
                    const picked = pickerSelected.has(p.id);
                    return (
                      <TouchableOpacity
                        key={p.id}
                        onPress={() => togglePick(p.id)}
                        style={[styles.gridCell, { borderWidth: 2, borderColor: picked ? colors.primary : "transparent" }]}
                        activeOpacity={0.8}
                      >
                        <VaultImage uri={imageUrl(p.url)} style={styles.gridImage} headers={authHeaders() as Record<string, string>} />
                        {picked && (
                          <>
                            <View style={[styles.pickOverlay, { backgroundColor: colors.primary + "33" }]} />
                            <View style={[styles.checkBadge, { backgroundColor: colors.primary }]}>
                              <Ionicons name="checkmark" size={10} color="#fff" />
                            </View>
                          </>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
            ) : (
              <View style={styles.modalCenter}>
                <Text style={styles.emptyIcon}>📷</Text>
                <Text style={[styles.emptyTitle, { color: colors.mutedForeground }]}>No photos to share</Text>
                <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Upload photos to your vault first</Text>
              </View>
            )}

            {pickerSelected.size > 0 && (
              <TouchableOpacity
                style={[styles.shareBar, { backgroundColor: colors.primary }]}
                activeOpacity={0.85}
                onPress={handleShare}
                disabled={isSharing}
              >
                {isSharing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.shareBarText}>
                    Share {pickerSelected.size} to vault
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    gap: 12,
  },
  backBtn: { marginBottom: 2, marginRight: 4 },
  headerText: { flex: 1 },
  title: { fontSize: 22, fontWeight: "700", fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 1 },
  proBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 4 },
  proBadgeText: { fontSize: 10, fontWeight: "900", fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 48 },
  scroll: { padding: 20 },
  gateEmoji: { fontSize: 44, marginBottom: 16 },
  gateTitle: { fontSize: 20, fontWeight: "800", fontFamily: "Inter_700Bold", marginBottom: 10, textAlign: "center" },
  gateBody: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21, textAlign: "center", marginBottom: 24 },
  confirmBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 16,
  },
  confirmText: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  upgradeBtn: {
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    marginTop: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  upgradeBtnText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15, fontWeight: "800" },
  upgradeModalSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    paddingHorizontal: 28,
    paddingTop: 12,
    alignItems: "center",
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 24 },
  upgradeModalEmoji: { fontSize: 48, marginBottom: 12 },
  upgradeModalTitle: { fontSize: 22, fontWeight: "800", fontFamily: "Inter_700Bold", textAlign: "center", marginBottom: 10 },
  upgradeModalBody: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21, textAlign: "center", marginBottom: 24 },
  upgradeModalBullets: { gap: 14, marginBottom: 8, width: "100%" },
  upgradeModalBulletRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  upgradeModalBulletText: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", flex: 1 },
  upgradeModalDismiss: { alignItems: "center", marginTop: 14, paddingVertical: 8 },
  upgradeModalDismissText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  filterBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginBottom: 14,
    alignSelf: "flex-start",
  },
  filterBadgeText: { fontSize: 13, fontWeight: "700" },
  countLabel: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 12 },
  chipRow: { flexDirection: "row", gap: 8, paddingBottom: 12 },
  chip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 6 },
  chipText: { fontSize: 12, fontWeight: "700", fontFamily: "Inter_600SemiBold" },
  mediaFilterRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  mediaFilterTab: { flex: 1, borderRadius: 10, borderWidth: 1, paddingVertical: 8, alignItems: "center" },
  mediaFilterText: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_600SemiBold" },
  segmented: { flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 4, gap: 4, marginBottom: 12 },
  segmentedBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, borderRadius: 9 },
  segmentedText: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_600SemiBold" },
  dateFilterRow: { flexDirection: "row", gap: 8, marginBottom: 12, alignItems: "center" },
  dateBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  dateBtnText: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_600SemiBold", maxWidth: 160 },
  dateClearBtn: { borderRadius: 10, borderWidth: 1, padding: 8 },
  favBtn: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  favRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  favRowText: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_600SemiBold" },
  pickerWrap: { marginBottom: 12 },
  pickerLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", fontWeight: "600", marginBottom: 6 },
  pickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pickerBtnText: { fontSize: 14, fontFamily: "Inter_400Regular", flex: 1, marginRight: 8 },
  pickerList: { borderWidth: 1, borderRadius: 12, marginTop: 6, overflow: "hidden" },
  pickerItem: { paddingHorizontal: 14, paddingVertical: 12 },
  pickerItemText: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  pickerItemSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 4, borderRadius: 14, overflow: "hidden", marginBottom: 16 },
  gridCell: {
    width: "31.8%",
    aspectRatio: 1,
    borderRadius: 10,
    overflow: "hidden",
    position: "relative",
    backgroundColor: "#1A1A26",
  },
  gridImage: { width: "100%", height: "100%", position: "relative", overflow: "hidden" },
  fallbackCell: { alignItems: "center", justifyContent: "center" },
  blurGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 16 },
  checkBadge: {
    position: "absolute",
    bottom: 6,
    left: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  detailCard: { borderRadius: 18, borderWidth: 1, overflow: "hidden", marginBottom: 16, padding: 16 },
  detailTitle: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 4 },
  detailMeta: { fontSize: 13, fontFamily: "Inter_400Regular" },
  emptyState: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 16,
    padding: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 4, textAlign: "center" },
  emptyTitle: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 4 },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 16,
    padding: 24,
    marginTop: 8,
  },
  uploadLabel: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  uploadSub: { fontSize: 12, fontFamily: "Inter_400Regular", position: "absolute", bottom: 8 },
  attrOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 6,
    paddingVertical: 5,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  attrAvatar: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  attrAvatarText: { fontSize: 9, fontWeight: "800", color: "#fff", fontFamily: "Inter_700Bold" },
  attrText: { flex: 1, fontSize: 9, color: "#fff", fontFamily: "Inter_600SemiBold" },
  removeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    marginTop: 14,
  },
  removeBtnText: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  rollUpBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    padding: 16,
    marginTop: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  rollUpBtnText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15, fontWeight: "800" },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  modalSheet: {
    maxHeight: "85%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingTop: 20,
    paddingHorizontal: 20,
  },
  modalHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 16 },
  modalHeaderText: { flex: 1 },
  modalTitle: { fontSize: 19, fontWeight: "700", fontFamily: "Inter_700Bold" },
  modalSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  modalCenter: { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 6 },
  modalScroll: { paddingBottom: 8 },
  pickOverlay: { ...StyleSheet.absoluteFillObject },
  proHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  proHintIcon: { fontSize: 18 },
  proHintText: { flex: 1, fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  shareBar: {
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    marginTop: 12,
  },
  shareBarText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15, fontWeight: "800" },
});
