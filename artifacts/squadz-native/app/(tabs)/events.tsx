import { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Platform,
  Modal,
  KeyboardAvoidingView,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useData } from "@/context/AppContext";
import { EventCard } from "@/components/EventCard";
import { Event, goingCount, parseEventDate } from "@/data/mock";

const FILTERS = ["All", "This Week", "Hosting", "Going", "Maybe"];

function JoinCodeModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { joinEvent } = useData();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "joined" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef<TextInput>(null);

  const handleClose = () => {
    setCode("");
    setStatus("idle");
    setErrorMsg("");
    onClose();
  };

  const handleJoin = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStatus("loading");
    setErrorMsg("");
    const result = await joinEvent(trimmed);
    if (result.error) {
      setStatus("error");
      setErrorMsg(result.error);
    } else {
      setStatus("joined");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.modalOverlay}
      >
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={handleClose} activeOpacity={1} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              paddingBottom: insets.bottom + 24,
            },
          ]}
        >
          <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />

          {status === "joined" ? (
            <View style={styles.successContent}>
              <View style={[styles.successIcon, { backgroundColor: colors.green + "22" }]}>
                <Ionicons name="checkmark-circle" size={52} color={colors.green} />
              </View>
              <Text style={[styles.successTitle, { color: colors.foreground }]}>You're in!</Text>
              <Text style={[styles.successSub, { color: colors.mutedForeground }]}>
                The event was added to your list.
              </Text>
              <TouchableOpacity
                onPress={handleClose}
                style={[styles.joinBtn, { backgroundColor: colors.primary, marginTop: 20 }]}
              >
                <Text style={styles.joinBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Join an Event</Text>
              <Text style={[styles.sheetSub, { color: colors.mutedForeground }]}>
                Enter the invite code shared with you (e.g. SQ-AB12)
              </Text>

              <View
                style={[
                  styles.codeInputRow,
                  {
                    backgroundColor: colors.background,
                    borderColor: errorMsg ? "#FF5C3A" : colors.border,
                  },
                ]}
              >
                <Ionicons name="ticket-outline" size={20} color={colors.mutedForeground} style={{ marginRight: 8 }} />
                <TextInput
                  ref={inputRef}
                  value={code}
                  onChangeText={(t) => {
                    setCode(t.toUpperCase());
                    if (errorMsg) setErrorMsg("");
                    if (status === "error") setStatus("idle");
                  }}
                  placeholder="SQ-AB12"
                  placeholderTextColor={colors.textDim}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="go"
                  onSubmitEditing={() => void handleJoin()}
                  style={[styles.codeInput, { color: colors.foreground }]}
                  editable={status !== "loading"}
                  autoFocus
                />
                {code.length > 0 && status !== "loading" && (
                  <TouchableOpacity onPress={() => { setCode(""); setErrorMsg(""); }}>
                    <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
                  </TouchableOpacity>
                )}
              </View>

              {errorMsg ? (
                <View style={styles.errorRow}>
                  <Ionicons name="warning-outline" size={14} color="#FF5C3A" />
                  <Text style={styles.errorText}>{errorMsg}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                onPress={() => void handleJoin()}
                disabled={status === "loading" || !code.trim()}
                style={[
                  styles.joinBtn,
                  {
                    backgroundColor: colors.primary,
                    opacity: status === "loading" || !code.trim() ? 0.5 : 1,
                    marginTop: 16,
                  },
                ]}
              >
                {status === "loading" ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.joinBtnText}>Join Event →</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function EventsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { events, currentUser, eventsLoading } = useData();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [showJoinModal, setShowJoinModal] = useState(false);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const matchesFilter = (e: Event): boolean => {
    switch (filter) {
      case "This Week": {
        const d = parseEventDate(e.date);
        return !!d && d >= now && d <= weekFromNow;
      }
      case "Hosting":
        return e.hostId === currentUser.id;
      case "Going":
        return e.rsvps[currentUser.id] === "going";
      case "Maybe":
        return e.rsvps[currentUser.id] === "maybe";
      default:
        return true;
    }
  };

  const filtered: Event[] = events.filter(
    (e) =>
      matchesFilter(e) &&
      (e.title.toLowerCase().includes(search.toLowerCase()) ||
        e.location.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.foreground }]}>Events</Text>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowJoinModal(true);
            }}
            style={[styles.joinCodeBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Ionicons name="ticket-outline" size={16} color={colors.primary} />
            <Text style={[styles.joinCodeText, { color: colors.primary }]}>Join with code</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="search-outline" size={18} color={colors.mutedForeground} />
          <TextInput
            placeholder="Search events..."
            placeholderTextColor={colors.textDim}
            value={search}
            onChangeText={setSearch}
            style={[styles.searchInput, { color: colors.foreground }]}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
        <FlatList
          data={FILTERS}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(f) => f}
          contentContainerStyle={{ gap: 8, paddingVertical: 10 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFilter(item); }}
              style={[
                styles.filterChip,
                {
                  backgroundColor: filter === item ? colors.primary : colors.card,
                  borderColor: filter === item ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={[styles.filterText, { color: filter === item ? "#fff" : colors.mutedForeground }]}>
                {item}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 8,
          paddingBottom: insets.bottom + (Platform.OS === "web" ? 84 : 100),
        }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          eventsLoading ? (
            <View style={styles.empty}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Ionicons name="calendar-outline" size={48} color={colors.textDim} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No events found</Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                Try a different search or filter
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <EventCard
            id={item.id}
            emoji={item.emoji}
            title={item.title}
            date={item.date}
            location={item.location}
            hostId={item.hostId}
            attendeeCount={goingCount(item)}
          />
        )}
      />

      <JoinCodeModal visible={showJoinModal} onClose={() => setShowJoinModal(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  title: { fontSize: 28, fontWeight: "900" },
  joinCodeBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 7,
  },
  joinCodeText: { fontSize: 13, fontWeight: "700" },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 13, borderWidth: 1.5, paddingHorizontal: 14, height: 48,
    marginBottom: 0,
  },
  searchInput: { flex: 1, fontSize: 15 },
  filterChip: { borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 6 },
  filterText: { fontSize: 13, fontWeight: "600" },
  empty: { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: "700" },
  emptySub: { fontSize: 14, textAlign: "center" },

  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 20 },
  sheetTitle: { fontSize: 22, fontWeight: "800", marginBottom: 6 },
  sheetSub: { fontSize: 14, lineHeight: 20, marginBottom: 20 },
  codeInputRow: {
    flexDirection: "row", alignItems: "center",
    borderRadius: 14, borderWidth: 1.5,
    paddingHorizontal: 14, height: 52,
  },
  codeInput: { flex: 1, fontSize: 18, fontWeight: "700", letterSpacing: 2 },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  errorText: { fontSize: 13, color: "#FF5C3A", fontWeight: "600", flex: 1 },
  joinBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  joinBtnText: { fontSize: 16, fontWeight: "800", color: "#fff" },
  successContent: { alignItems: "center", paddingVertical: 12 },
  successIcon: { width: 90, height: 90, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  successTitle: { fontSize: 28, fontWeight: "800", marginBottom: 6 },
  successSub: { fontSize: 15, textAlign: "center" },
});
