import { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Platform,
  Alert,
  Share,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import QRCode from "react-native-qrcode-svg";
import { useColors } from "@/hooks/useColors";
import { useData, useAuth } from "@/context/AppContext";
// Shared auth-race guard (see lib/vaultAuthRace.ts): a pre-token-restore 401 on
// the friends fetch must keep this screen loading, not flash "No friends yet".
import { vaultRenderMode } from "@/lib/vaultAuthRace";
import { UserAvatar } from "@/components/UserAvatar";
import { useMessages } from "@/context/MessagesContext";
import { useUserCache } from "@/context/UserCacheContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";

export default function FriendsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { friends, friendCode, addFriend, removeFriend, friendsLoading, friendsAuthPending, friendsAuthError, retryFriends } = useData();
  const { authToken } = useAuth();
  const { resolveUser, prefetchUsers } = useUserCache();
  const { startDirectConversation } = useMessages();
  const [codeInput, setCodeInput] = useState("");
  const [showQR, setShowQR] = useState(false);
  const [messagingId, setMessagingId] = useState<string | null>(null);
  const [addingFriend, setAddingFriend] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; isError: boolean } | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  /** Copy text to clipboard with execCommand fallback for cross-origin iframes. */
  function webCopy(text: string): boolean {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      return ok;
    } catch { return false; }
  }

  /** Show a brief inline feedback banner (web-only substitute for Alert.alert). */
  function showFeedback(text: string, isError = false) {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setFeedbackMsg({ text, isError });
    feedbackTimer.current = setTimeout(() => setFeedbackMsg(null), 3500);
  }

  // Pre-load friend profiles
  useEffect(() => {
    if (friends.length > 0) prefetchUsers(friends);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friends]);

  async function handleMessage(userId: string) {
    if (messagingId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMessagingId(userId);
    try {
      const convoId = await startDirectConversation(userId);
      setMessagingId(null);
      if (convoId) {
        router.push(`/conversation/${convoId}` as never);
      } else {
        Alert.alert("Couldn't open chat", "Please try again in a moment.");
      }
    } catch (err: unknown) {
      setMessagingId(null);
      const code = err instanceof Error ? (err as Error & { code?: string }).code : undefined;
      if (code === "NO_SHARED_SQUAD") {
        // W-01: give users a clear, actionable explanation rather than silent no-op.
        Alert.alert(
          "Can't send a message",
          "You and this person need to be in the same squad before you can message each other.",
        );
      } else {
        Alert.alert("Couldn't open chat", "Please try again in a moment.");
      }
    }
  }

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const friendUsers = friends.map((id) => resolveUser(id));

  // Single source of truth for the friends-list body. `authPending` keeps us on
  // the spinner (never the empty state) during a slow-login auth race; the "No
  // friends yet" empty is only reached for a genuine authenticated zero result.
  const renderMode = vaultRenderMode({
    loading: friendsLoading,
    authPending: friendsAuthPending,
    authError: friendsAuthError,
    photoCount: friendUsers.length,
  });

  function buildInviteUrl(code: string): string {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      return `${window.location.origin}/api/add/friend/${code}`;
    }
    return `${API_BASE}/api/add/friend/${code}`;
  }

  function handleShareCode() {
    if (!friendCode) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const inviteUrl = buildInviteUrl(friendCode);
    Share.share({
      message: `Add me on SquadZ! 👥\n\nTap the link to add me instantly:\n${inviteUrl}\n\nOr use code: ${friendCode}`,
      url: inviteUrl,
      title: "Add me on SquadZ",
    });
  }

  async function handleCopyCode() {
    if (!friendCode) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS === "web") {
      // Try modern clipboard API first; fall back to execCommand for
      // cross-origin iframes (e.g. Replit preview) where clipboard is blocked.
      let copied = false;
      try {
        await navigator.clipboard.writeText(friendCode);
        copied = true;
      } catch {
        copied = webCopy(friendCode);
      }
      if (copied) {
        setCodeCopied(true);
        setTimeout(() => setCodeCopied(false), 2000);
      } else {
        showFeedback(`Your code: ${friendCode}`, false);
      }
    } else {
      try {
        await Share.share({
          message: `Add me on SquadZ! My friend code is ${friendCode}`,
          title: "My SquadZ Friend Code",
        });
      } catch {
        // dismissed
      }
    }
  }

  async function handleSmsInvite() {
    if (!friendCode) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const inviteUrl = buildInviteUrl(friendCode);
    const msg = `Hey! Add me on SquadZ 🎉\n\nTap the link: ${inviteUrl}\n\nOr use my code: ${friendCode}`;
    if (Platform.OS !== "web") {
      try {
        const SMS = await import("expo-sms");
        const available = await SMS.isAvailableAsync();
        if (available) {
          await SMS.sendSMSAsync([], msg);
          return;
        }
      } catch {
        // fall through to Share
      }
    }
    Share.share({ message: msg, title: "Add me on SquadZ" });
  }

  function notify(title: string, message: string, isError = false) {
    if (Platform.OS === "web") {
      showFeedback(message, isError);
    } else {
      Alert.alert(title, message);
    }
  }

  async function handleAddFriend() {
    const code = codeInput.trim().toUpperCase();
    if (!code || addingFriend) return;
    if (!code.startsWith("SQ-")) {
      notify("Invalid Code", "Friend codes look like SQ-XXXX. Check the code and try again.", true);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAddingFriend(true);
    try {
      const res = await fetch(`${API_BASE}/api/users/by-friend-code/${encodeURIComponent(code)}`, {
        headers: buildAuthHeaders(authToken),
      });
      if (res.status === 404) {
        notify("Code Not Found", "No SquadZ user has that friend code. Double-check it and try again.", true);
        return;
      }
      if (!res.ok) {
        notify("Something went wrong", "Couldn't look up that code. Please try again.", true);
        return;
      }
      const found = await res.json() as { id: string; firstName?: string; lastName?: string };
      const name = [found.firstName, found.lastName].filter(Boolean).join(" ") || "your new friend";
      if (friends.includes(found.id)) {
        notify("Already Friends!", `You and ${name} are already connected on SquadZ.`);
        return;
      }
      addFriend(found.id);
      setCodeInput("");
      inputRef.current?.blur();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      notify("Friend Added! 🎉", `You and ${name} are now friends on SquadZ.`);
    } catch {
      notify("Network Error", "Couldn't connect. Please check your connection and try again.", true);
    } finally {
      setAddingFriend(false);
    }
  }

  function handleRemove(userId: string) {
    const user = resolveUser(userId);
    Alert.alert(`Remove ${user.name}?`, "They'll no longer appear in your friends list.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); removeFriend(userId); },
      },
    ]);
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
          style={[styles.backBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Ionicons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Friends</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Inline feedback banner — replaces Alert.alert (no-op on web) */}
      {feedbackMsg && (
        <View style={{
          marginHorizontal: 16, marginTop: 8,
          borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10,
          backgroundColor: feedbackMsg.isError ? "#ff444420" : "#22c55e20",
          borderWidth: 1,
          borderColor: feedbackMsg.isError ? "#ff444450" : "#22c55e50",
        }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: feedbackMsg.isError ? "#ef4444" : "#16a34a" }}>
            {feedbackMsg.text}
          </Text>
        </View>
      )}

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{ paddingBottom: botPad + 24, paddingHorizontal: 20, paddingTop: 20 }}
        showsVerticalScrollIndicator={false}
      >
        {/* My Code card */}
        <View style={[styles.codeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.codeCardTop}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.codeLabel, { color: colors.mutedForeground }]}>MY FRIEND CODE</Text>
              <Text style={[styles.codeValue, { color: friendCode ? colors.foreground : colors.mutedForeground }]}>
                {friendCode || "Loading…"}
              </Text>
              <Text style={[styles.codeSub, { color: colors.mutedForeground }]}>
                Share this code so friends can add you
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowQR(!showQR); }}
              style={[styles.qrToggle, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "30" }]}
            >
              <Ionicons name="qr-code" size={22} color={colors.primary} />
            </TouchableOpacity>
          </View>

          {showQR && friendCode ? (
            <View style={[styles.qrWrap, { borderTopColor: colors.border }]}>
              <View style={[styles.qrBox, { backgroundColor: "#fff" }]}>
                <QRCode
                  value={buildInviteUrl(friendCode)}
                  size={160}
                  color="#0F0F14"
                  backgroundColor="#ffffff"
                />
              </View>
              <Text style={[styles.qrHint, { color: colors.mutedForeground }]}>
                Let someone scan this to add you instantly
              </Text>
            </View>
          ) : null}

          <TouchableOpacity
            onPress={handleShareCode}
            disabled={!friendCode}
            style={[styles.shareBtn, { backgroundColor: colors.primary, opacity: friendCode ? 1 : 0.5 }]}
          >
            <Ionicons name="share-outline" size={18} color="#fff" />
            <Text style={styles.shareBtnText}>Share My Code</Text>
          </TouchableOpacity>
        </View>

        {/* Add a Friend */}
        <View style={styles.addFriendHeader}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ADD A FRIEND</Text>
          {friendCode ? (
            <TouchableOpacity
              onPress={() => void handleCopyCode()}
              style={[
                styles.myCodeChip,
                {
                  backgroundColor: codeCopied ? colors.green + "20" : colors.primary + "15",
                  borderColor: codeCopied ? colors.green + "50" : colors.primary + "35",
                },
              ]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.myCodeChipLabel, { color: colors.mutedForeground }]}>Your code: </Text>
              <Text style={[styles.myCodeChipValue, { color: codeCopied ? colors.green : colors.primary }]}>
                {friendCode}
              </Text>
              <Ionicons
                name={codeCopied ? "checkmark" : (Platform.OS === "web" ? "copy-outline" : "share-outline")}
                size={13}
                color={codeCopied ? colors.green : colors.primary}
                style={{ marginLeft: 4 }}
              />
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={[styles.addRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="people-outline" size={20} color={colors.mutedForeground} style={{ marginLeft: 14 }} />
          <TextInput
            ref={inputRef}
            placeholder="Enter friend code (SQ-XXXX)"
            placeholderTextColor={colors.textDim}
            value={codeInput}
            onChangeText={setCodeInput}
            autoCapitalize="characters"
            returnKeyType="done"
            onSubmitEditing={() => void handleAddFriend()}
            style={[styles.addInput, { color: colors.foreground }]}
          />
          <TouchableOpacity
            onPress={() => void handleAddFriend()}
            disabled={!codeInput.trim() || addingFriend}
            style={[
              styles.addBtn,
              { backgroundColor: codeInput.trim() && !addingFriend ? colors.primary : colors.surfaceUp },
            ]}
          >
            {addingFriend ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={[styles.addBtnText, { color: codeInput.trim() ? "#fff" : colors.textDim }]}>Add</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Friends list */}
        <View style={styles.listHeader}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            FRIENDS — {friendUsers.length}
          </Text>
        </View>

        {renderMode === "loading" ? (
          <View style={[styles.empty, { borderColor: colors.border }]}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : renderMode === "error" ? (
          <View style={[styles.empty, { borderColor: colors.border }]}>
            <Ionicons name="cloud-offline-outline" size={40} color={colors.textDim} style={{ marginBottom: 10 }} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Couldn't load your friends</Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              Check your connection and try again.
            </Text>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); retryFriends(); }}
              style={[styles.retryBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : renderMode === "empty" ? (
          <View style={[styles.empty, { borderColor: colors.border }]}>
            <Text style={{ fontSize: 40, marginBottom: 10 }}>👥</Text>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No friends yet</Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              Share your code or enter a friend's code above to connect
            </Text>
          </View>
        ) : (
          friendUsers.map((user) => (
            <View
              key={user.id}
              style={[styles.friendRow, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <UserAvatar
                initials={user.initials}
                color={user.color}
                imageUrl={user.profileImageUrl}
                size={44}
                fontSize={16}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.friendName, { color: colors.foreground }]}>{user.name}</Text>
                <Text style={[styles.friendSub, { color: colors.mutedForeground }]}>SquadZ friend</Text>
              </View>
              <TouchableOpacity
                onPress={() => handleMessage(user.id)}
                disabled={messagingId === user.id}
                style={[styles.messageBtn, { backgroundColor: colors.primary + "1A", borderColor: colors.primary + "40" }]}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                {messagingId === user.id ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name="chatbubble-outline" size={18} color={colors.primary} />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleRemove(user.id)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close-circle-outline" size={22} color={colors.textDim} />
              </TouchableOpacity>
            </View>
          ))
        )}

        {/* Invite more */}
        <TouchableOpacity
          onPress={handleSmsInvite}
          style={[styles.inviteMoreBtn, { borderColor: colors.primary + "40" }]}
        >
          <Ionicons name="chatbubble-outline" size={20} color={colors.primary} />
          <Text style={[styles.inviteMoreText, { color: colors.primary }]}>Invite more people via text</Text>
        </TouchableOpacity>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 18, fontWeight: "800" },
  codeCard: {
    borderRadius: 18, borderWidth: 1, padding: 18, marginBottom: 24, gap: 16,
  },
  codeCardTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  codeLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 },
  codeValue: { fontSize: 28, fontWeight: "900", letterSpacing: 3, fontVariant: ["tabular-nums"], marginBottom: 4 },
  codeSub: { fontSize: 12, lineHeight: 16 },
  qrToggle: {
    width: 52, height: 52, borderRadius: 14, borderWidth: 1,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  qrWrap: { alignItems: "center", gap: 12, borderTopWidth: 1, paddingTop: 16 },
  qrBox: { borderRadius: 16, padding: 12 },
  qrHint: { fontSize: 12, textAlign: "center" },
  shareBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, borderRadius: 13, paddingVertical: 13,
  },
  shareBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  sectionLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 },
  addFriendHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  myCodeChip: {
    flexDirection: "row", alignItems: "center", borderRadius: 20, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  myCodeChipLabel: { fontSize: 12, fontWeight: "600" },
  myCodeChipValue: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },
  addRow: {
    flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1,
    marginBottom: 24, height: 52, overflow: "hidden",
  },
  addInput: { flex: 1, paddingHorizontal: 12, fontSize: 15, height: "100%" },
  addBtn: { paddingHorizontal: 18, height: "100%", alignItems: "center", justifyContent: "center" },
  addBtnText: { fontWeight: "700", fontSize: 14 },
  listHeader: { marginBottom: 10 },
  friendRow: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 8,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  messageBtn: {
    width: 38, height: 38, borderRadius: 19, borderWidth: 1,
    alignItems: "center", justifyContent: "center", marginRight: 4,
  },
  friendName: { fontSize: 15, fontWeight: "700", marginBottom: 2 },
  friendSub: { fontSize: 12 },
  empty: {
    alignItems: "center", paddingVertical: 36, borderRadius: 16,
    borderWidth: 1, borderStyle: "dashed", marginBottom: 16,
  },
  emptyTitle: { fontSize: 17, fontWeight: "800", marginBottom: 6 },
  emptySub: { fontSize: 13, textAlign: "center", lineHeight: 18, paddingHorizontal: 24 },
  retryBtn: { marginTop: 16, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 24 },
  retryBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  inviteMoreBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    borderRadius: 14, borderWidth: 1.5, borderStyle: "dashed", padding: 14, marginTop: 4,
  },
  inviteMoreText: { fontSize: 14, fontWeight: "700" },
});
