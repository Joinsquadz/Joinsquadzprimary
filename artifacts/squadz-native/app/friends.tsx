import { useState, useRef } from "react";
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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import QRCode from "react-native-qrcode-svg";
import { useColors } from "@/hooks/useColors";
import { useData } from "@/context/AppContext";
import { USERS, getUserById } from "@/data/mock";

const NON_ME = USERS.filter((u) => u.id !== "me");

export default function FriendsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { friends, friendCode, addFriend, removeFriend } = useData();
  const [codeInput, setCodeInput] = useState("");
  const [showQR, setShowQR] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const friendUsers = friends.map(getUserById);

  function handleShareCode() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Share.share({
      message: `Add me on Squadz! Use my friend code: ${friendCode} 👥\nDownload the app at squadz.app`,
      title: "Join me on Squadz",
    });
  }

  function handleAddFriend() {
    const code = codeInput.trim().toUpperCase();
    if (!code) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const notFriend = NON_ME.find((u) => !friends.includes(u.id));
    if (!notFriend) {
      Alert.alert("All Connected!", "You're already friends with everyone on Squadz. 🎉");
      return;
    }
    if (friends.length > 0 && !code.startsWith("SQ-")) {
      Alert.alert("Invalid Code", "Friend codes look like SQ-XXXX. Check the code and try again.");
      return;
    }
    addFriend(notFriend.id);
    setCodeInput("");
    inputRef.current?.blur();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("Friend Added! 🎉", `You and ${notFriend.name} are now friends on Squadz.`);
  }

  function handleRemove(userId: string) {
    const user = getUserById(userId);
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

      <ScrollView
        contentContainerStyle={{ paddingBottom: botPad + 24, paddingHorizontal: 20, paddingTop: 20 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* My Code card */}
        <View style={[styles.codeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.codeCardTop}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.codeLabel, { color: colors.mutedForeground }]}>MY FRIEND CODE</Text>
              <Text style={[styles.codeValue, { color: colors.foreground }]}>{friendCode}</Text>
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

          {showQR && (
            <View style={[styles.qrWrap, { borderTopColor: colors.border }]}>
              <View style={[styles.qrBox, { backgroundColor: "#fff" }]}>
                <QRCode
                  value={`squadz://friend/${friendCode}`}
                  size={160}
                  color="#0A0A0F"
                  backgroundColor="#ffffff"
                />
              </View>
              <Text style={[styles.qrHint, { color: colors.mutedForeground }]}>
                Let someone scan this to add you instantly
              </Text>
            </View>
          )}

          <TouchableOpacity
            onPress={handleShareCode}
            style={[styles.shareBtn, { backgroundColor: colors.primary }]}
          >
            <Ionicons name="share-outline" size={18} color="#fff" />
            <Text style={styles.shareBtnText}>Share My Code</Text>
          </TouchableOpacity>
        </View>

        {/* Add a Friend */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ADD A FRIEND</Text>
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
            onSubmitEditing={handleAddFriend}
            style={[styles.addInput, { color: colors.foreground }]}
          />
          <TouchableOpacity
            onPress={handleAddFriend}
            disabled={!codeInput.trim()}
            style={[
              styles.addBtn,
              { backgroundColor: codeInput.trim() ? colors.primary : colors.surfaceUp },
            ]}
          >
            <Text style={[styles.addBtnText, { color: codeInput.trim() ? "#fff" : colors.textDim }]}>Add</Text>
          </TouchableOpacity>
        </View>

        {/* Friends list */}
        <View style={styles.listHeader}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            FRIENDS — {friendUsers.length}
          </Text>
        </View>

        {friendUsers.length === 0 ? (
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
              <View style={[styles.avatar, { backgroundColor: user.color }]}>
                <Text style={styles.avatarText}>{user.initials}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.friendName, { color: colors.foreground }]}>{user.name}</Text>
                <Text style={[styles.friendSub, { color: colors.mutedForeground }]}>Squadz friend</Text>
              </View>
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
          onPress={() => router.push("/onboarding" as never)}
          style={[styles.inviteMoreBtn, { borderColor: colors.primary + "40" }]}
        >
          <Ionicons name="mail-outline" size={20} color={colors.primary} />
          <Text style={[styles.inviteMoreText, { color: colors.primary }]}>Invite more people via text</Text>
        </TouchableOpacity>
      </ScrollView>
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
  friendName: { fontSize: 15, fontWeight: "700", marginBottom: 2 },
  friendSub: { fontSize: 12 },
  empty: {
    alignItems: "center", paddingVertical: 36, borderRadius: 16,
    borderWidth: 1, borderStyle: "dashed", marginBottom: 16,
  },
  emptyTitle: { fontSize: 17, fontWeight: "800", marginBottom: 6 },
  emptySub: { fontSize: 13, textAlign: "center", lineHeight: 18, paddingHorizontal: 24 },
  inviteMoreBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    borderRadius: 14, borderWidth: 1.5, borderStyle: "dashed", padding: 14, marginTop: 4,
  },
  inviteMoreText: { fontSize: 14, fontWeight: "700" },
});
