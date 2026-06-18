import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useData } from "@/context/AppContext";
import { useUserCache, type ResolvedUser } from "@/context/UserCacheContext";
import { UserAvatar } from "@/components/UserAvatar";
import { SettleUp } from "@/components/SettleUp";
import { computeEvenShares } from "@/lib/costSplit";
import type { Event } from "@/types";

type Props = {
  event: Event;
  isHost: boolean;
  botPad: number;
  /** Resolved users who can be included in a split (squad members + invited). */
  participants: ResolvedUser[];
};

/**
 * Self-contained cost-splitting feature shared by the event and trip detail
 * screens: group budget, totals, settle-up, expense list, and the add-expense
 * + budget modals. Owns all its own state; talks to AppContext directly.
 */
export function EventCostsPanel({ event, isHost, botPad, participants }: Props) {
  const colors = useColors();
  const {
    currentUser,
    addCost,
    markSharePaid,
    confirmShare,
    fetchPaymentHandles,
    ownPaymentHandles,
    updateEvent,
  } = useData();
  const { resolveUser } = useUserCache();

  const resolveForDisplay = (userId: string): ResolvedUser =>
    userId === currentUser.id
      ? { ...(currentUser as unknown as ResolvedUser), isPro: resolveUser(currentUser.id).isPro }
      : resolveUser(userId);

  // ---- Cost modal state ----
  const [costModal, setCostModal] = useState(false);
  const [costDesc, setCostDesc] = useState("");
  const [costTotal, setCostTotal] = useState("");
  const [costShares, setCostShares] = useState<Record<string, string>>({});
  const [splitMode, setSplitMode] = useState<"even" | "manual">("even");
  const [costSaving, setCostSaving] = useState(false);
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<Set<string>>(new Set());
  const [paymentHandles, setPaymentHandles] = useState<
    Record<string, { venmo: string | null; cashapp: string | null; zelle: string | null }>
  >({});

  // ---- Budget modal state ----
  const [budgetModal, setBudgetModal] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");

  // Load payment handles to power settle-up deep links.
  useEffect(() => {
    if (!event.id) return;
    let active = true;
    void fetchPaymentHandles(event.id).then((h) => {
      if (active) setPaymentHandles(h);
    });
    return () => { active = false; };
  }, [event.id, fetchPaymentHandles]);

  // ---- Budget derived ----
  const spent = event.costs.reduce((s, c) => s + c.amount, 0);
  const hasBudget = event.budget != null;
  const budgetVal = event.budget ?? 0;
  const budgetRemaining = budgetVal - spent;
  const budgetPct = budgetVal > 0 ? Math.min(100, (spent / budgetVal) * 100) : 0;
  const budgetPerPerson = budgetVal / Math.max(1, participants.length);
  const budgetOver = budgetRemaining < 0;

  // ---- Split derived ----
  const totalNum = parseFloat(costTotal) || 0;
  const splitParticipants = participants.filter((m) => selectedParticipantIds.has(m.id));
  const evenShares = computeEvenShares(totalNum, splitParticipants.map((m) => m.id));
  const activeShares = splitMode === "even" ? evenShares : costShares;
  const shareValues = splitParticipants.map((m) => parseFloat(activeShares[m.id] || "0") || 0);
  const hasNegative = shareValues.some((v) => v < 0);
  const assignedNum = shareValues.reduce((sum, v) => sum + v, 0);
  const remaining = totalNum - assignedNum;
  const covered = totalNum > 0 && splitParticipants.length > 0 && !hasNegative && Math.abs(remaining) < 0.01;

  const participantIdSet = new Set(participants.map((p) => p.id));

  // ---- Handlers ----
  const openCostModal = () => {
    setCostDesc("");
    setCostTotal("");
    setCostShares({});
    setSplitMode("even");
    setSelectedParticipantIds(new Set(participants.map((p) => p.id)));
    setCostModal(true);
  };

  const toggleSplitParticipant = (uid: string) => {
    setSelectedParticipantIds((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const switchToManual = () => {
    setCostShares({ ...evenShares });
    setSplitMode("manual");
  };

  const saveCost = async () => {
    if (costSaving) return;
    if (!costDesc.trim()) {
      Alert.alert("Missing info", "Add a description for the expense.");
      return;
    }
    if (totalNum <= 0) {
      Alert.alert("Missing amount", "Enter a total greater than $0.");
      return;
    }
    if (splitParticipants.length === 0) {
      Alert.alert("No one selected", "Select at least one person to split the cost with.");
      return;
    }
    if (hasNegative) {
      Alert.alert("Invalid amount", "Shares can't be negative. Enter $0 or more for each person.");
      return;
    }
    if (!covered) {
      Alert.alert("Bill not covered", `Assign the full $${totalNum.toFixed(2)} across people. $${remaining.toFixed(2)} left.`);
      return;
    }
    const shares = splitParticipants
      .map((m) => ({ userId: m.id, amount: parseFloat(activeShares[m.id] || "0") || 0 }))
      .filter((s) => s.amount > 0);
    setCostSaving(true);
    try {
      const result = await addCost(event.id, { description: costDesc.trim(), amount: totalNum, shares }, event.version);
      if (result.error) {
        Alert.alert("Couldn't save expense", result.error);
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCostModal(false);
    } finally {
      setCostSaving(false);
    }
  };

  const openBudget = () => {
    setBudgetInput(event.budget != null ? String(event.budget) : "");
    setBudgetModal(true);
  };
  const saveBudget = () => {
    const val = parseFloat(budgetInput);
    if (isNaN(val) || val < 0) {
      Alert.alert("Invalid budget", "Enter a budget of $0 or more.");
      return;
    }
    updateEvent(event.id, { budget: val }, event.version);
    setBudgetModal(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };
  const clearBudget = () => {
    updateEvent(event.id, { budget: undefined }, event.version);
    setBudgetModal(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <View style={{ gap: 8 }}>
      {hasBudget ? (
        <View style={[styles.budgetCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.budgetHead}>
            <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Group budget</Text>
            {isHost && (
              <TouchableOpacity onPress={openBudget} style={styles.budgetEdit}>
                <Ionicons name="create-outline" size={15} color={colors.primary} />
                <Text style={[styles.budgetEditText, { color: colors.primary }]}>Edit</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={[styles.budgetAmount, { color: colors.foreground }]}>${budgetVal.toFixed(2)}</Text>
          <View style={[styles.budgetTrack, { backgroundColor: colors.surfaceUp }]}>
            <View style={[styles.budgetFill, { width: `${budgetPct}%`, backgroundColor: budgetOver ? colors.destructive : colors.green }]} />
          </View>
          <View style={styles.budgetMetaRow}>
            <Text style={[styles.budgetMeta, { color: colors.mutedForeground }]}>${spent.toFixed(2)} spent</Text>
            <Text style={[styles.budgetMeta, { color: budgetOver ? colors.destructive : colors.green }]}>
              {budgetOver ? `$${Math.abs(budgetRemaining).toFixed(2)} over` : `$${budgetRemaining.toFixed(2)} left`}
            </Text>
          </View>
          <Text style={[styles.budgetPer, { color: colors.textDim }]}>≈ ${budgetPerPerson.toFixed(2)} per person</Text>
        </View>
      ) : isHost ? (
        <TouchableOpacity onPress={openBudget} style={[styles.addRow, { borderColor: colors.border }]}>
          <Ionicons name="wallet-outline" size={20} color={colors.primary} />
          <Text style={[styles.addText, { color: colors.primary }]}>Set group budget</Text>
        </TouchableOpacity>
      ) : null}

      {event.costs.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="card-outline" size={40} color={colors.textDim} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No expenses yet</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Add a bill and split it with your squad</Text>
        </View>
      ) : (
        <>
          <View style={[styles.totalsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View>
              <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Total spent</Text>
              <Text style={[styles.totalsValue, { color: colors.foreground }]}>
                ${event.costs.reduce((s, c) => s + c.amount, 0).toFixed(2)}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Your share</Text>
              <Text style={[styles.totalsValue, { color: colors.primary }]}>
                ${event.costs.reduce((s, c) => s + (c.shares.find((sh) => sh.userId === currentUser.id)?.amount ?? 0), 0).toFixed(2)}
              </Text>
            </View>
          </View>
          <SettleUp
            costs={event.costs}
            meId={currentUser.id}
            eventTitle={event.title}
            colors={colors}
            handles={{
              ...paymentHandles,
              [currentUser.id]: {
                venmo: ownPaymentHandles.venmo,
                cashapp: ownPaymentHandles.cashapp,
                zelle: ownPaymentHandles.zelle,
              },
            }}
            resolveUser={resolveForDisplay}
            onMarkPaid={(costId, paid) => markSharePaid(event.id, costId, paid, event.version)}
            onConfirm={(costId, debtorId, confirmed) => confirmShare(event.id, costId, debtorId, confirmed, event.version)}
          />
          {event.costs.map((cost) => {
            const payer = resolveForDisplay(cost.paidById);
            const myShare = cost.shares.find((s) => s.userId === currentUser.id)?.amount ?? 0;
            const shareIds = cost.shares.map((s) => s.userId);
            const isEveryone =
              participantIdSet.size > 0 &&
              shareIds.length === participantIdSet.size &&
              shareIds.every((uid) => participantIdSet.has(uid));
            const participantLabel = isEveryone
              ? "Everyone"
              : shareIds
                  .map((uid) => (uid === currentUser.id ? "you" : resolveForDisplay(uid).name.split(" ")[0]))
                  .join(", ");
            return (
              <View key={cost.id} style={[styles.costRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.costDesc, { color: colors.foreground }]}>{cost.description}</Text>
                  <Text style={[styles.costPayer, { color: colors.mutedForeground }]}>
                    Paid by {payer.id === currentUser.id ? "you" : payer.name}
                  </Text>
                  <Text style={[styles.costPayer, { color: colors.mutedForeground }]} numberOfLines={2}>
                    Split with: {participantLabel}
                  </Text>
                </View>
                <View style={styles.costRight}>
                  <Text style={[styles.costTotal, { color: colors.foreground }]}>${cost.amount.toFixed(2)}</Text>
                  <Text style={[styles.costShare, { color: colors.mutedForeground }]}>you owe ${myShare.toFixed(2)}</Text>
                </View>
              </View>
            );
          })}
        </>
      )}
      <TouchableOpacity onPress={openCostModal} style={[styles.addRow, { borderColor: colors.border }]}>
        <Ionicons name="add" size={20} color={colors.primary} />
        <Text style={[styles.addText, { color: colors.primary }]}>Add expense</Text>
      </TouchableOpacity>

      {/* ---- Add Expense Modal ---- */}
      <Modal visible={costModal} transparent animationType="slide" onRequestClose={() => setCostModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCardLarge, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: botPad + 16 }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add expense</Text>
            <Text style={[styles.modalHint, { color: colors.mutedForeground }]}>You paid. Choose how to split the bill.</Text>
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <TextInput
                placeholder="What's it for? (e.g. Pizza)"
                placeholderTextColor={colors.textDim}
                value={costDesc}
                onChangeText={setCostDesc}
                style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              />
              <View style={[styles.modalInput, styles.amountRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.dollar, { color: colors.mutedForeground }]}>$</Text>
                <TextInput
                  placeholder="0.00"
                  placeholderTextColor={colors.textDim}
                  value={costTotal}
                  onChangeText={setCostTotal}
                  keyboardType="decimal-pad"
                  style={[styles.amountInput, { color: colors.foreground }]}
                />
              </View>

              {participants.length > 1 && (
                <>
                  <Text style={[styles.assignLabel, { color: colors.mutedForeground }]}>Who's included</Text>
                  {participants.map((m) => {
                    const selected = selectedParticipantIds.has(m.id);
                    return (
                      <TouchableOpacity
                        key={m.id}
                        onPress={() => toggleSplitParticipant(m.id)}
                        style={[
                          styles.assignRow,
                          { borderColor: selected ? colors.primary + "50" : colors.border, backgroundColor: selected ? colors.primary + "08" : "transparent" },
                        ]}
                        activeOpacity={0.7}
                      >
                        <UserAvatar initials={m.initials} color={m.color} imageUrl={m.profileImageUrl} size={32} fontSize={11} />
                        <Text style={[styles.assignName, { color: colors.foreground, flex: 1 }]}>
                          {m.name.split(" ")[0]}{m.id === currentUser.id ? " (You)" : ""}
                        </Text>
                        <View style={[
                          styles.participantCheckbox,
                          { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary : "transparent" },
                        ]}>
                          {selected && <Ionicons name="checkmark" size={13} color="#fff" />}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  {splitParticipants.length === 0 && (
                    <Text style={[styles.assignLabel, { color: colors.destructive, marginTop: 2 }]}>Select at least one person.</Text>
                  )}
                </>
              )}

              <View style={[styles.splitToggle, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <TouchableOpacity onPress={() => setSplitMode("even")} style={[styles.splitToggleBtn, splitMode === "even" && { backgroundColor: colors.primary }]}>
                  <Text style={[styles.splitToggleText, { color: splitMode === "even" ? "#fff" : colors.mutedForeground }]}>Split evenly</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={switchToManual} style={[styles.splitToggleBtn, splitMode === "manual" && { backgroundColor: colors.primary }]}>
                  <Text style={[styles.splitToggleText, { color: splitMode === "manual" ? "#fff" : colors.mutedForeground }]}>Enter manually</Text>
                </TouchableOpacity>
              </View>

              {splitParticipants.length > 0 && (
                <>
                  <Text style={[styles.assignLabel, { color: colors.mutedForeground }]}>Who owes what</Text>
                  {splitParticipants.map((m) => (
                    <View key={m.id} style={[styles.assignRow, { borderColor: colors.border }]}>
                      <UserAvatar initials={m.initials} color={m.color} imageUrl={m.profileImageUrl} size={32} fontSize={11} />
                      <Text style={[styles.assignName, { color: colors.foreground }]}>{m.name.split(" ")[0]}{m.id === currentUser.id ? " (You)" : ""}</Text>
                      {splitMode === "even" ? (
                        <View style={[styles.assignInputWrap, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
                          <Text style={[styles.dollar, { color: colors.primary }]}>$</Text>
                          <Text style={[styles.assignInput, { color: colors.primary, textAlignVertical: "center", paddingTop: 2 }]}>
                            {activeShares[m.id] ?? "—"}
                          </Text>
                        </View>
                      ) : (
                        <View style={[styles.assignInputWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
                          <Text style={[styles.dollar, { color: colors.textDim }]}>$</Text>
                          <TextInput
                            placeholder="0"
                            placeholderTextColor={colors.textDim}
                            value={costShares[m.id] ?? ""}
                            onChangeText={(v) => setCostShares((p) => ({ ...p, [m.id]: v }))}
                            keyboardType="decimal-pad"
                            style={[styles.assignInput, { color: colors.foreground }]}
                          />
                        </View>
                      )}
                    </View>
                  ))}
                </>
              )}
            </ScrollView>

            <View style={[styles.coverageBar, { borderColor: covered ? colors.green : colors.border, backgroundColor: (covered ? colors.green : colors.gold) + "15" }]}>
              <Ionicons name={covered ? "checkmark-circle" : "alert-circle-outline"} size={16} color={covered ? colors.green : colors.gold} />
              <Text style={[styles.coverageText, { color: covered ? colors.green : colors.gold }]}>
                {covered
                  ? `Covered · $${totalNum.toFixed(2)} assigned`
                  : `$${assignedNum.toFixed(2)} of $${totalNum.toFixed(2)} · $${remaining.toFixed(2)} left`}
              </Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setCostModal(false)} style={[styles.modalBtn, { backgroundColor: colors.card }]}>
                <Text style={[styles.modalBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={saveCost}
                disabled={totalNum <= 0 || !covered || costSaving}
                style={[styles.modalBtn, { backgroundColor: covered ? colors.primary : colors.border, opacity: (totalNum <= 0 || !covered || costSaving) ? 0.45 : 1 }]}
              >
                {costSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: covered ? "#fff" : colors.textDim }]}>Save expense</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ---- Budget Modal ---- */}
      <Modal visible={budgetModal} transparent animationType="fade" onRequestClose={() => setBudgetModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Group budget</Text>
            <View style={[styles.modalInput, styles.amountRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.dollar, { color: colors.mutedForeground }]}>$</Text>
              <TextInput
                placeholder="0.00"
                placeholderTextColor={colors.textDim}
                value={budgetInput}
                onChangeText={setBudgetInput}
                keyboardType="decimal-pad"
                autoFocus
                style={[styles.amountInput, { color: colors.foreground }]}
              />
            </View>
            {hasBudget && (
              <TouchableOpacity onPress={clearBudget} style={styles.clearBudgetBtn}>
                <Text style={[styles.clearBudgetText, { color: colors.destructive }]}>Remove budget</Text>
              </TouchableOpacity>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setBudgetModal(false)} style={[styles.modalBtn, { backgroundColor: colors.card }]}>
                <Text style={[styles.modalBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveBudget} style={[styles.modalBtn, { backgroundColor: colors.primary }]}>
                <Text style={[styles.modalBtnText, { color: "#fff" }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  budgetCard: { borderRadius: 14, borderWidth: 1, padding: 16 },
  budgetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  budgetEdit: { flexDirection: "row", alignItems: "center", gap: 3 },
  budgetEditText: { fontSize: 13, fontWeight: "700" },
  budgetAmount: { fontSize: 26, fontWeight: "900", marginTop: 4, marginBottom: 12 },
  budgetTrack: { height: 8, borderRadius: 4, overflow: "hidden" },
  budgetFill: { height: 8, borderRadius: 4 },
  budgetMetaRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  budgetMeta: { fontSize: 13, fontWeight: "700" },
  budgetPer: { fontSize: 12, marginTop: 6 },
  cardTitle: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  totalsCard: { flexDirection: "row", justifyContent: "space-between", borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 4 },
  totalsValue: { fontSize: 22, fontWeight: "900", marginTop: 2 },
  costRow: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 14 },
  costDesc: { fontSize: 14, fontWeight: "700" },
  costPayer: { fontSize: 12, marginTop: 2 },
  costRight: { alignItems: "flex-end" },
  costTotal: { fontSize: 16, fontWeight: "800" },
  costShare: { fontSize: 12 },
  addRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", padding: 14 },
  addText: { fontSize: 14, fontWeight: "700" },
  emptyState: { alignItems: "center", paddingTop: 40, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: "800" },
  emptySub: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalCard: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, padding: 20, gap: 12 },
  modalCardLarge: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, padding: 20, gap: 10 },
  modalTitle: { fontSize: 19, fontWeight: "800" },
  modalHint: { fontSize: 13, marginTop: -4 },
  modalInput: { borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14, height: 50, fontSize: 15, marginTop: 8 },
  amountRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dollar: { fontSize: 16, fontWeight: "700" },
  amountInput: { flex: 1, fontSize: 16, fontWeight: "700", height: "100%" },
  splitToggle: { flexDirection: "row", borderRadius: 12, borderWidth: 1.5, marginTop: 10, overflow: "hidden" },
  splitToggleBtn: { flex: 1, paddingVertical: 9, alignItems: "center", justifyContent: "center" },
  splitToggleText: { fontSize: 13, fontWeight: "700" },
  assignLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginTop: 14, marginBottom: 6 },
  assignRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 10, borderWidth: 1, borderColor: "transparent" },
  assignName: { flex: 1, fontSize: 14, fontWeight: "600" },
  participantCheckbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  assignInputWrap: { flexDirection: "row", alignItems: "center", gap: 2, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, width: 100, height: 40 },
  assignInput: { flex: 1, fontSize: 14, fontWeight: "700", height: "100%" },
  coverageBar: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 },
  coverageText: { fontSize: 13, fontWeight: "700" },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 6 },
  modalBtn: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 14, paddingVertical: 14 },
  modalBtnText: { fontSize: 15, fontWeight: "800" },
  clearBudgetBtn: { alignItems: "center", paddingVertical: 4 },
  clearBudgetText: { fontSize: 13, fontWeight: "700" },
});
