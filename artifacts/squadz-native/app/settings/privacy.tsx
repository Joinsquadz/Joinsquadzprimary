import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
  Linking,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { subscriptionManagementUrl } from "@/lib/subscriptionManagement";

type Prefs = {
  privateProfile: boolean;
  showRsvpActivity: boolean;
};

const ROWS: { key: keyof Prefs; icon: keyof typeof Ionicons.glyphMap; label: string; sub: string }[] = [
  { key: "privateProfile", icon: "lock-closed-outline", label: "Private Profile", sub: "Only squad members can see your profile" },
  { key: "showRsvpActivity", icon: "eye-outline", label: "Show RSVP Activity", sub: "Let squads see when you're going" },
];

export default function PrivacyScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { authToken, deleteAccount, isPro } = useAuth();

  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // B5: iOS App Store subscriptions can't be cancelled server-side, so if this
  // user has Squadz+ we must warn them and link to the native manage screen.
  const [hasPlus, setHasPlus] = useState(false);
  // BUS-01: explicit acknowledgment required before deleting when an Apple IAP
  // subscription is active (Apple provides no server-side cancel API).
  const [iosSubAcknowledged, setIosSubAcknowledged] = useState(false);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const authHeaders = useCallback((): Record<string, string> => {
    return buildAuthHeaders(authToken);
  }, [authToken]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/user/preferences`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json() as Prefs;
        setPrefs({ privateProfile: data.privateProfile, showRsvpActivity: data.showRsvpActivity });
      }
    } catch {
      // leave prefs null → error state shown
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  // Entitlement comes from the global store (AppContext) instead of a screen-local
  // fetch, so this warning reflects a purchase made anywhere in the app. Unresolved
  // (isPro === null) reads as "no warning", matching the previous fail-quiet behaviour.
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    setHasPlus(isPro === true);
  }, [isPro]);

  async function toggle(key: keyof Prefs, value: boolean) {
    if (!prefs) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const prev = prefs;
    setPrefs({ ...prefs, [key]: value });
    try {
      const res = await fetch(`${API_BASE}/api/user/preferences`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) setPrefs(prev);
    } catch {
      setPrefs(prev);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setDeleting(true);
    setDeleteError(null);
    const result = await deleteAccount();
    if (result.ok) {
      setConfirmOpen(false);
      router.replace("/login" as never);
      return;
    }
    setDeleting(false);
    setDeleteError(result.error ?? "Couldn't delete your account. Please try again.");
  }

  const links: { icon: keyof typeof Ionicons.glyphMap; label: string; url: string }[] = [
    { icon: "document-text-outline", label: "Terms of Service", url: "https://joinsquadz.com/terms" },
    { icon: "shield-checkmark-outline", label: "Privacy Policy", url: "https://joinsquadz.com/privacy" },
  ];

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => { if (router.canGoBack()) { router.back(); } else { router.replace("/profile" as never); } }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Privacy</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : !prefs ? (
        <View style={styles.center}>
          <Text style={[styles.sectionHint, { color: colors.mutedForeground, textAlign: "center", marginBottom: 14 }]}>
            Couldn't load your settings.
          </Text>
          <TouchableOpacity
            onPress={() => void load()}
            style={{ paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.primary, fontWeight: "600" }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}>
          <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>
            Control who can see you and your activity.
          </Text>
          <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {ROWS.map((row, i) => (
              <View
                key={row.key}
                style={[styles.row, i < ROWS.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
              >
                <View style={[styles.iconWrap, { backgroundColor: colors.primary + "18" }]}>
                  <Ionicons name={row.icon} size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabel, { color: colors.foreground }]}>{row.label}</Text>
                  <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>{row.sub}</Text>
                </View>
                <Switch
                  value={prefs[row.key]}
                  onValueChange={(v) => toggle(row.key, v)}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  thumbColor="#fff"
                />
              </View>
            ))}
          </View>

          <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>LEGAL</Text>
          <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {links.map((link, i) => (
              <TouchableOpacity
                key={link.label}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); void Linking.openURL(link.url); }}
                style={[styles.row, i < links.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
              >
                <View style={[styles.iconWrap, { backgroundColor: colors.primary + "18" }]}>
                  <Ionicons name={link.icon} size={18} color={colors.primary} />
                </View>
                <Text style={[styles.rowLabel, { color: colors.foreground, flex: 1 }]}>{link.label}</Text>
                <Ionicons name="open-outline" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.groupLabel, { color: "#E5484D" }]}>DANGER ZONE</Text>
          <View style={[styles.group, { backgroundColor: colors.card, borderColor: "#E5484D55" }]}>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setDeleteError(null); setConfirmOpen(true); }}
              style={styles.row}
            >
              <View style={[styles.iconWrap, { backgroundColor: "#E5484D18" }]}>
                <Ionicons name="trash-outline" size={18} color="#E5484D" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, { color: "#E5484D" }]}>Delete Account</Text>
                <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>Permanently erase your account and all data</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#E5484D" />
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => { if (!deleting) setConfirmOpen(false); }}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.modalIcon, { backgroundColor: "#E5484D18" }]}>
              <Ionicons name="warning-outline" size={28} color="#E5484D" />
            </View>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Delete your account?</Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
              This permanently erases your profile, squads you solely own, photos, messages, events, and friends. Squads you created with others will transfer to another member. This can't be undone.
            </Text>

            {Platform.OS === "ios" && hasPlus ? (
              <>
                <Text style={[styles.modalBody, { color: colors.mutedForeground, marginTop: 8 }]}>
                  Deleting your account does not cancel your App Store subscription — you will keep being billed until you cancel it separately.
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    const url = subscriptionManagementUrl("ios");
                    if (url) void Linking.openURL(url);
                  }}
                  style={[styles.manageSubBtn, { borderColor: colors.border }]}
                >
                  <Text style={[styles.manageSubText, { color: colors.foreground }]}>Manage Subscription</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setIosSubAcknowledged((v) => !v)}
                  style={styles.ackRow}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: iosSubAcknowledged }}
                >
                  <Ionicons
                    name={iosSubAcknowledged ? "checkbox" : "square-outline"}
                    size={22}
                    color={iosSubAcknowledged ? "#E5484D" : colors.mutedForeground}
                  />
                  <Text style={[styles.ackText, { color: colors.mutedForeground }]}>
                    I understand I must cancel my App Store subscription separately
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}

            {deleteError ? (
              <Text style={styles.modalError}>{deleteError}</Text>
            ) : null}

            <TouchableOpacity
              onPress={() => void handleDelete()}
              disabled={deleting || (Platform.OS === "ios" && hasPlus && !iosSubAcknowledged)}
              style={[styles.deleteBtn, (deleting || (Platform.OS === "ios" && hasPlus && !iosSubAcknowledged)) && { opacity: 0.45 }]}
            >
              {deleting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.deleteBtnText}>Delete my account</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => { if (!deleting) setConfirmOpen(false); }}
              disabled={deleting}
              style={styles.cancelBtn}
            >
              <Text style={[styles.cancelBtnText, { color: colors.foreground }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  sectionHint: { fontSize: 14, marginBottom: 16, lineHeight: 20 },
  group: { borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  groupLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, marginTop: 24, marginBottom: 10, marginLeft: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14 },
  iconWrap: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  rowLabel: { fontSize: 15, fontWeight: "600" },
  rowSub: { fontSize: 12, marginTop: 2 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", maxWidth: 380, borderWidth: 1, borderRadius: 20, padding: 24, alignItems: "center" },
  modalIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  modalTitle: { fontSize: 19, fontWeight: "800", marginBottom: 10, textAlign: "center" },
  modalBody: { fontSize: 14, lineHeight: 21, textAlign: "center", marginBottom: 18 },
  modalError: { color: "#E5484D", fontSize: 13, textAlign: "center", marginBottom: 14 },
  manageSubBtn: { width: "100%", borderWidth: 1, borderRadius: 14, paddingVertical: 12, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  manageSubText: { fontSize: 15, fontWeight: "600" },
  deleteBtn: { width: "100%", backgroundColor: "#E5484D", borderRadius: 14, paddingVertical: 15, alignItems: "center", justifyContent: "center", minHeight: 50 },
  deleteBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  cancelBtn: { width: "100%", paddingVertical: 14, alignItems: "center", marginTop: 4 },
  cancelBtnText: { fontSize: 15, fontWeight: "600" },
  ackRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, width: "100%", marginTop: 14, marginBottom: 4 },
  ackText: { flex: 1, fontSize: 13, lineHeight: 18 },
});
