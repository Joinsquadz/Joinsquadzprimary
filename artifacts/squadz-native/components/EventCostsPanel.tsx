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
import { useUserCache, type ResolvedUser } from "@/context/UserCacheContext";
import { UserAvatar } from "@/components/UserAvatar";
import { SettleUp } from "@/components/SettleUp";
import { computeEvenShares, computeWeightedShares, isWholeCent, isValidCostAmounts } from "@/lib/costSplit";
import { BillDetailsFields, formatBillDetails, useBillDetailsForm } from "@/components/BillDetailsFields";
import type { Event } from "@/types";
import { useEffect, useState, useCallback } from "react";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useData, useAuth } from "@/context/AppContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

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
    updateCost,
    deleteCost,
    markSharePaid,
    confirmShare,
    fetchPaymentHandles,
    ownPaymentHandles,
    updateEvent,
  } = useData();
  const { authToken } = useAuth();
  const { resolveUser } = useUserCache();

  const resolveForDisplay = (userId: string): ResolvedUser =>
    userId === currentUser.id
      ? { ...(currentUser as unknown as ResolvedUser), isPro: resolveUser(currentUser.id).isPro }
      : resolveUser(userId);

  // ---- Cost modal state ----
  const [costModal, setCostModal] = useState(false);
  // Non-null while the modal is editing an existing cost (vs. adding a new one).
  const [editingCostId, setEditingCostId] = useState<string | null>(null);
  const [costDesc, setCostDesc] = useState("");
  const [costTotal, setCostTotal] = useState("");
  const bill = useBillDetailsForm();
  const [costShares, setCostShares] = useState<Record<string, string>>({});
  const [costWeights, setCostWeights] = useState<Record<string, string>>({});
  const [splitMode, setSplitMode] = useState<"even" | "manual" | "weighted">("even");
  const [costSaving, setCostSaving] = useState(false);
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<Set<string>>(new Set());
  const [paymentHandles, setPaymentHandles] = useState<
    Record<string, { venmo: string | null; cashapp: string | null; zelle: string | null }>
  >({});
  // ---- Receipt state ----
  /** Local URI of a freshly-picked image (pre-upload), for in-modal preview. */
  const [receiptLocalUri, setReceiptLocalUri] = useState<string | null>(null);
  /** Server-side object path of the uploaded (or pre-existing) receipt. */
  const [receiptObjectPath, setReceiptObjectPath] = useState<string | null>(null);
  const [receiptUploading, setReceiptUploading] = useState(false);
  /** Path opened in the full-screen viewer; null = closed. */
  const [receiptViewerPath, setReceiptViewerPath] = useState<string | null>(null);

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
  const billDetails = bill.billDetails;
  const totalNum = bill.show ? bill.billTotal : parseFloat(costTotal) || 0;
  const splitParticipants = participants.filter((m) => selectedParticipantIds.has(m.id));
  const evenShares = computeEvenShares(totalNum, splitParticipants.map((m) => m.id));
  const parsedWeights = Object.fromEntries(
    splitParticipants.map((m) => [m.id, parseFloat(costWeights[m.id] || "0") || 0]),
  );
  const totalWeight = splitParticipants.reduce((s, m) => s + (parsedWeights[m.id] || 0), 0);
  const weightedShares = computeWeightedShares(totalNum, parsedWeights);
  const activeShares =
    splitMode === "even" ? evenShares
    : splitMode === "weighted" ? weightedShares
    : costShares;
  const shareValues = splitParticipants.map((m) => parseFloat(activeShares[m.id] || "0") || 0);
  const hasNegative = shareValues.some((v) => v < 0);
  const assignedNum = shareValues.reduce((sum, v) => sum + v, 0);
  const remaining = totalNum - assignedNum;
  const covered =
    totalNum > 0 && splitParticipants.length > 0 && !hasNegative &&
    (splitMode === "weighted" ? totalWeight > 0 : Math.abs(remaining) < 0.01);

  // Run the same predicate the server uses so mismatch errors surface on-device
  // before the API call. In "even"/"weighted" modes the shares are computed and
  // always reconcile; this primarily catches hand-edited manual amounts.
  const sharesToValidate = splitParticipants
    .map((m) => ({ amount: parseFloat(activeShares[m.id] || "0") || 0 }))
    .filter((s) => s.amount > 0);
  const splitValid =
    totalNum > 0 && splitParticipants.length > 0 && !hasNegative &&
    isValidCostAmounts(totalNum, sharesToValidate, billDetails ?? undefined);
  // Human-readable mismatch description shown in the inline banner.
  const splitMismatchMsg =
    !splitValid && totalNum > 0 && splitParticipants.length > 0 && !hasNegative && assignedNum > 0
      ? `Shares add up to $${assignedNum.toFixed(2)} but the total is $${totalNum.toFixed(2)}`
      : null;

  const participantIdSet = new Set(participants.map((p) => p.id));

  // ---- Departed-member display (D4) ----
  // A payer/debtor whose id is neither the current user nor a current
  // participant can no longer be resolved to a squad member — render a
  // stable "(left squad)" / "Former member" label instead of a raw miss.
  const isDeparted = (userId: string): boolean =>
    userId !== currentUser.id && !participantIdSet.has(userId);
  const departedLabel = (userId: string): string => {
    const u = resolveForDisplay(userId);
    const known = !!u.name && u.name !== "..." && u.name !== "Unknown";
    return known ? `${u.name} (left squad)` : "Former member";
  };
  // Full display name for a payer line.
  const payerName = (userId: string): string =>
    userId === currentUser.id ? "you" : isDeparted(userId) ? departedLabel(userId) : resolveForDisplay(userId).name;
  // Short (first-name) label used in the "Split with" summary.
  const shortName = (userId: string): string => {
    if (userId === currentUser.id) return "you";
    if (isDeparted(userId)) return departedLabel(userId);
    return resolveForDisplay(userId).name.split(" ")[0];
  };

  // ---- Receipt upload ----
  const pickAndUploadReceipt = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow photo library access to attach a receipt.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: false,
      quality: 0.85,
    });
    if (result.canceled || !result.assets.length) return;
    const asset = result.assets[0];
    setReceiptLocalUri(asset.uri);
    setReceiptUploading(true);
    try {
      const contentType = asset.mimeType ?? "image/jpeg";
      const name = asset.fileName ?? "receipt.jpg";
      const size = asset.fileSize ?? 0;
      const urlRes = await fetch(`${API_BASE}/api/storage/uploads/request-url`, {
        method: "POST",
        headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
        body: JSON.stringify({ name, size, contentType }),
      });
      if (!urlRes.ok) {
        const body = (await urlRes.json().catch(() => ({}))) as { error?: string };
        Alert.alert("Upload failed", body.error ?? "Couldn't start the upload. Please try again.");
        setReceiptLocalUri(null);
        return;
      }
      const { uploadURL, objectPath } = (await urlRes.json()) as { uploadURL: string; objectPath: string };
      const { uri: strippedUri, mimeType: strippedMime } = await stripMediaExif(asset.uri, contentType);
      const fileRes = await fetch(strippedUri);
      const blob = await fileRes.blob();
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": strippedMime },
      });
      if (!putRes.ok) {
        Alert.alert("Upload failed", "Couldn't upload the photo. Please try again.");
        setReceiptLocalUri(null);
        return;
      }
      setReceiptObjectPath(objectPath);
    } catch {
      Alert.alert("Upload failed", "Something went wrong. Please try again.");
      setReceiptLocalUri(null);
    } finally {
      setReceiptUploading(false);
    }
  }, [authToken]);

  // ---- Handlers ----
  const openCostModal = () => {
    setEditingCostId(null);
    setCostDesc("");
    setCostTotal("");
    bill.reset();
    setCostShares({});
    setCostWeights({});
    setSplitMode("even");
    setSelectedParticipantIds(new Set(participants.map((p) => p.id)));
    setReceiptLocalUri(null);
    setReceiptObjectPath(null);
    setCostModal(true);
  };

  const openEditCostModal = (cost: Event["costs"][number]) => {
    setEditingCostId(cost.id);
    setCostDesc(cost.description);
    setCostTotal(String(cost.amount));
    bill.loadFrom(cost.billDetails);
    const shareMap: Record<string, string> = {};
    cost.shares.forEach((s) => { shareMap[s.userId] = String(s.amount); });
    setCostShares(shareMap);
    setCostWeights({});
    setSplitMode("manual");
    // Prefill selection with the cost's current split members that are still
    // resolvable participants (departed members drop out of the editable set).
    setSelectedParticipantIds(
      new Set(cost.shares.map((s) => s.userId).filter((uid) => participantIdSet.has(uid))),
    );
    // Pre-load any existing receipt (no local URI — it's already on the server).
    setReceiptLocalUri(null);
    setReceiptObjectPath(cost.receiptUrl ?? null);
    setCostModal(true);
  };

  const confirmDeleteCost = (cost: Event["costs"][number]) => {
    Alert.alert(
      "Delete this cost? Balances for everyone in this split will update.",
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const result = await deleteCost(event.id, cost.id, event.version);
            if (result.error) {
              Alert.alert(result.conflict ? "Cost changed" : "Couldn't delete expense", result.error);
              return;
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ],
    );
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
    // Pre-fill manual inputs with whatever the current mode computes.
    setCostShares(splitMode === "weighted" ? { ...weightedShares } : { ...evenShares });
    setSplitMode("manual");
  };

  const switchToWeighted = () => {
    // Even → weighted: equal weights. Manual → weighted: use dollar amounts as weights.
    const newWeights: Record<string, string> = {};
    splitParticipants.forEach((m) => {
      newWeights[m.id] = splitMode === "manual" ? (costShares[m.id] ?? "1") : "1";
    });
    setCostWeights(newWeights);
    setSplitMode("weighted");
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
    if (!isWholeCent(totalNum) || shareValues.some((amount) => !isWholeCent(amount))) {
      Alert.alert("Use cents", "Enter amounts with no more than two decimal places.");
      return;
    }
    if (!splitValid) {
      Alert.alert(
        "Split doesn't add up",
        splitMismatchMsg ?? `Assign the full $${totalNum.toFixed(2)} across people. $${Math.abs(remaining).toFixed(2)} ${remaining > 0 ? "left" : "over"}.`,
      );
      return;
    }
    if (receiptUploading) {
      Alert.alert("Please wait", "Receipt photo is still uploading.");
      return;
    }
    const shares = splitParticipants
      .map((m) => ({ userId: m.id, amount: parseFloat(activeShares[m.id] || "0") || 0 }))
      .filter((s) => s.amount > 0);
    setCostSaving(true);
    try {
      const payload = {
        description: costDesc.trim(),
        amount: totalNum,
        shares,
        billDetails,
        ...(receiptObjectPath !== undefined ? { receiptUrl: receiptObjectPath } : {}),
      };
      const result = editingCostId
        ? await updateCost(event.id, editingCostId, payload, event.version)
        : await addCost(event.id, payload, event.version);
      if (result.error) {
        Alert.alert(
          "conflict" in result && result.conflict ? "Cost changed" : "Couldn't save expense",
          result.error,
        );
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
            memberIds={new Set([currentUser.id, ...participantIdSet])}
            onMarkPaid={(costId, paid) => markSharePaid(event.id, costId, paid, event.version)}
            onConfirm={(costId, debtorId, confirmed) => confirmShare(event.id, costId, debtorId, confirmed, event.version)}
          />
          {event.costs.map((cost) => {
            const myShare = cost.shares.find((s) => s.userId === currentUser.id)?.amount ?? 0;
            const shareIds = cost.shares.map((s) => s.userId);
            const isEveryone =
              participantIdSet.size > 0 &&
              shareIds.length === participantIdSet.size &&
              shareIds.every((uid) => participantIdSet.has(uid));
            const participantLabel = isEveryone
              ? "Everyone"
              : shareIds.map((uid) => shortName(uid)).join(", ");
            // D5: only the payer or the event host may edit/delete a cost.
            const canModify = cost.paidById === currentUser.id || isHost;
            return (
              <View key={cost.id} style={[styles.costRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.costDesc, { color: colors.foreground }]}>{cost.description}</Text>
                  <Text style={[styles.costPayer, { color: colors.mutedForeground }]}>
                    Paid by {payerName(cost.paidById)}
                  </Text>
                  <Text style={[styles.costPayer, { color: colors.mutedForeground }]} numberOfLines={2}>
                    Split with: {participantLabel}
                  </Text>
                  {cost.billDetails && (
                    <Text style={[styles.costPayer, { color: colors.mutedForeground }]} numberOfLines={2}>
                      {formatBillDetails(cost.billDetails)}
                    </Text>
                  )}
                  {cost.receiptUrl && (
                    <TouchableOpacity
                      onPress={() => { Haptics.selectionAsync(); setReceiptViewerPath(cost.receiptUrl!); }}
                      hitSlop={4}
                      style={styles.receiptRowBtn}
                    >
                      <Image
                        source={{ uri: receiptImgUrl(cost.receiptUrl) }}
                        style={styles.receiptRowThumb}
                        contentFit="cover"
                      />
                      <Text style={[styles.costPayer, { color: colors.primary }]}>View receipt</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.costRight}>
                  <Text style={[styles.costTotal, { color: colors.foreground }]}>${cost.amount.toFixed(2)}</Text>
                  <Text style={[styles.costShare, { color: colors.mutedForeground }]}>you owe ${myShare.toFixed(2)}</Text>
                </View>
                {canModify && (
                  <View style={styles.costActions}>
                    <TouchableOpacity
                      onPress={() => { Haptics.selectionAsync(); openEditCostModal(cost); }}
                      hitSlop={8}
                      style={styles.costActionBtn}
                    >
                      <Ionicons name="pencil" size={17} color={colors.mutedForeground} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => { Haptics.selectionAsync(); confirmDeleteCost(cost); }}
                      hitSlop={8}
                      style={styles.costActionBtn}
                    >
                      <Ionicons name="trash-outline" size={17} color={colors.destructive} />
                    </TouchableOpacity>
                  </View>
                )}
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
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>{editingCostId ? "Edit expense" : "Add expense"}</Text>
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
              <BillDetailsFields form={bill} />

              {/* ---- Receipt photo ---- */}
              <Text style={[styles.assignLabel, { color: colors.mutedForeground }]}>Receipt photo (optional)</Text>
              {receiptLocalUri || receiptObjectPath ? (
                <View style={styles.receiptPreviewWrap}>
                  <Image
                    source={{ uri: receiptLocalUri ?? receiptImgUrl(receiptObjectPath!) }}
                    style={styles.receiptPreviewThumb}
                    contentFit="cover"
                  />
                  {receiptUploading && (
                    <View style={styles.receiptUploadOverlay}>
                      <ActivityIndicator size="small" color="#fff" />
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.receiptRemoveBtn}
                    onPress={() => { setReceiptLocalUri(null); setReceiptObjectPath(null); }}
                    hitSlop={8}
                  >
                    <Ionicons name="close-circle" size={22} color={colors.destructive} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.receiptPickBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                  onPress={pickAndUploadReceipt}
                  disabled={receiptUploading}
                  activeOpacity={0.7}
                >
                  {receiptUploading ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Ionicons name="camera-outline" size={20} color={colors.primary} />
                  )}
                  <Text style={[styles.receiptPickText, { color: colors.primary }]}>
                    {receiptUploading ? "Uploading…" : "Attach receipt photo"}
                  </Text>
                </TouchableOpacity>
              )}

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
                  <Text style={[styles.splitToggleText, { color: splitMode === "even" ? "#fff" : colors.mutedForeground }]}>Even</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={switchToWeighted} style={[styles.splitToggleBtn, splitMode === "weighted" && { backgroundColor: colors.primary }]}>
                  <Text style={[styles.splitToggleText, { color: splitMode === "weighted" ? "#fff" : colors.mutedForeground }]}>By shares</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={switchToManual} style={[styles.splitToggleBtn, splitMode === "manual" && { backgroundColor: colors.primary }]}>
                  <Text style={[styles.splitToggleText, { color: splitMode === "manual" ? "#fff" : colors.mutedForeground }]}>Manual</Text>
                </TouchableOpacity>
              </View>
              {splitMode === "weighted" && (
                <Text style={[styles.assignLabel, { color: colors.mutedForeground, marginTop: 6, textTransform: "none", letterSpacing: 0 }]}>
                  Enter shares or % — e.g. 2 and 1 = ⅔ and ⅓ of the bill.
                </Text>
              )}

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
                      ) : splitMode === "weighted" ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <View style={[styles.assignInputWrap, { backgroundColor: colors.card, borderColor: colors.border, width: 64 }]}>
                            <TextInput
                              placeholder="1"
                              placeholderTextColor={colors.textDim}
                              value={costWeights[m.id] ?? ""}
                              onChangeText={(v) => setCostWeights((p) => ({ ...p, [m.id]: v }))}
                              keyboardType="decimal-pad"
                              style={[styles.assignInput, { color: colors.foreground }]}
                            />
                          </View>
                          <Text style={[styles.weightPreview, { color: totalWeight > 0 ? colors.mutedForeground : colors.textDim }]}>
                            {totalWeight > 0 ? `$${weightedShares[m.id] ?? "0.00"}` : "—"}
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

            <View style={[styles.coverageBar, { borderColor: splitValid ? colors.green : colors.destructive + "60", backgroundColor: (splitValid ? colors.green : colors.destructive) + "12" }]}>
              <Ionicons name={splitValid ? "checkmark-circle" : "alert-circle"} size={16} color={splitValid ? colors.green : colors.destructive} />
              <Text style={[styles.coverageText, { color: splitValid ? colors.green : colors.destructive, flexShrink: 1 }]}>
                {splitValid
                  ? `Covered · $${totalNum.toFixed(2)} assigned`
                  : splitMismatchMsg ?? (totalNum > 0 ? `$${assignedNum.toFixed(2)} of $${totalNum.toFixed(2)} assigned — $${Math.abs(remaining).toFixed(2)} ${remaining > 0 ? "left" : "over"}` : "Enter a total and assign shares")}
              </Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setCostModal(false)} style={[styles.modalBtn, { backgroundColor: colors.card }]}>
                <Text style={[styles.modalBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={saveCost}
                disabled={totalNum <= 0 || !splitValid || costSaving}
                style={[styles.modalBtn, { backgroundColor: splitValid ? colors.primary : colors.border, opacity: (totalNum <= 0 || !splitValid || costSaving) ? 0.45 : 1 }]}
              >
                {costSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: covered ? "#fff" : colors.textDim }]}>{editingCostId ? "Save changes" : "Save expense"}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ---- Receipt full-screen viewer ---- */}
      <Modal
        visible={receiptViewerPath !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setReceiptViewerPath(null)}
      >
        <View style={styles.viewerOverlay}>
          <TouchableOpacity style={styles.viewerClose} onPress={() => setReceiptViewerPath(null)} hitSlop={12}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {receiptViewerPath && (
            <Image
              source={{ uri: receiptImgUrl(receiptViewerPath) }}
              style={styles.viewerImage}
              contentFit="contain"
            />
          )}
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
  costActions: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: 8 },
  costActionBtn: { padding: 6 },
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
  weightPreview: { fontSize: 13, fontWeight: "700", minWidth: 54, textAlign: "right" },
  coverageBar: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 },
  coverageText: { fontSize: 13, fontWeight: "700" },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 6 },
  modalBtn: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 14, paddingVertical: 14 },
  modalBtnText: { fontSize: 15, fontWeight: "800" },
  clearBudgetBtn: { alignItems: "center", paddingVertical: 4 },
  clearBudgetText: { fontSize: 13, fontWeight: "700" },
  // Receipt photo — modal picker
  receiptPickBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", paddingHorizontal: 14, paddingVertical: 12, marginBottom: 4 },
  receiptPickText: { fontSize: 14, fontWeight: "700" },
  receiptPreviewWrap: { position: "relative", width: 100, height: 80, borderRadius: 10, overflow: "visible", marginBottom: 4 },
  receiptPreviewThumb: { width: 100, height: 80, borderRadius: 10 },
  receiptUploadOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)", borderRadius: 10, alignItems: "center", justifyContent: "center" },
  receiptRemoveBtn: { position: "absolute", top: -8, right: -8, backgroundColor: "#fff", borderRadius: 12 },
  // Receipt photo — cost row
  receiptRowBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  receiptRowThumb: { width: 36, height: 28, borderRadius: 5 },
  // Full-screen receipt viewer
  viewerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  viewerImage: { width: "100%", height: "85%" },
  viewerClose: { position: "absolute", top: 52, right: 20, zIndex: 10, padding: 6 },
});

/** Builds the absolute URL for a protected receipt object path. Mirrors the
 *  pattern used in EventVaultPanel so expo-image can load it on native. */
const receiptImgUrl = (objectPath: string): string =>
  /^https?:\/\//i.test(objectPath) ? objectPath : `${API_BASE}/api/storage${objectPath}`;
