import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { UserAvatar } from "@/components/UserAvatar";
import { resolveUploadedUrl } from "@/lib/api";
import { IDEA_CATEGORY_META, ideaSubmitterName } from "@/lib/ideaUtils";
import type { PlanIdea } from "@/types";

/**
 * One idea, in either surface:
 * - "board": the Ideas tab (pending/archived) — big vote chip + actions.
 * - "inline": a confirmed idea merged into an itinerary day group — visually
 *   distinct from stops (lightbulb accent, vote tally, attribution) so members
 *   can tell what was voted in vs planned directly.
 *
 * All actions are optional; the card only renders affordances it was given
 * (read-only plans simply pass none). Action menus expand in-card — never a
 * second Modal (iOS freezes on stacked Modals).
 */
export function IdeaCard({
  idea,
  variant,
  isMine,
  canManage,
  readOnly,
  reordering = false,
  canMoveUp = false,
  canMoveDown = false,
  onVote,
  onEdit,
  onDelete,
  onConfirm,
  onArchive,
  onReactivate,
  onUnconfirm,
  onPin,
  onMove,
  onEnterReorder,
}: {
  idea: PlanIdea;
  variant: "board" | "inline";
  isMine: boolean;
  canManage: boolean;
  readOnly: boolean;
  reordering?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onVote?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onConfirm?: () => void;
  onArchive?: () => void;
  onReactivate?: () => void;
  onUnconfirm?: () => void;
  onPin?: () => void;
  onMove?: (dir: "up" | "down") => void;
  onEnterReorder?: () => void;
}) {
  const colors = useColors();
  const [actionsOpen, setActionsOpen] = useState(false);
  const meta = IDEA_CATEGORY_META[idea.category] ?? IDEA_CATEGORY_META.other;
  const tint = colors[meta.colorKey];
  const pending = idea.status === "pending";
  const archived = idea.status === "archived";
  const submitterName = ideaSubmitterName(idea);
  const avatarUrl = idea.submittedBy?.profileImageUrl
    ? resolveUploadedUrl(idea.submittedBy.profileImageUrl)
    : undefined;
  const initials = submitterName
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const canEdit = !readOnly && (canManage || (isMine && pending)) && !!onEdit;
  const canDelete = !readOnly && (canManage || (isMine && pending)) && !!onDelete;
  const hasManageActions =
    !readOnly && canManage && (pending ? !!(onConfirm || onArchive || onPin) : archived ? !!onReactivate : !!onUnconfirm);
  const hasAnyAction = canEdit || canDelete || hasManageActions;

  const openLink = () => {
    if (idea.linkUrl) void Linking.openURL(idea.linkUrl).catch(() => {});
  };

  const act = (fn?: () => void) => () => {
    setActionsOpen(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fn?.();
  };

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      disabled={variant !== "inline" || !canManage || readOnly || !onEnterReorder}
      onLongPress={
        variant === "inline" && canManage && !readOnly && onEnterReorder
          ? () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onEnterReorder();
            }
          : undefined
      }
      style={[
        styles.card,
        {
          borderColor: idea.pinned && pending ? colors.gold + "88" : colors.border,
          backgroundColor: variant === "inline" ? tint + "0D" : colors.card,
          borderStyle: variant === "inline" ? "dashed" : "solid",
        },
      ]}
      accessibilityLabel={`Idea: ${idea.title}`}
    >
      <View style={styles.topRow}>
        <View style={[styles.ideaBadge, { backgroundColor: tint + "22" }]}>
          <Ionicons name="bulb" size={14} color={tint} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            {idea.pinned && pending ? (
              <Ionicons name="pin" size={13} color={colors.gold} style={{ marginRight: 4 }} />
            ) : null}
            <Text
              style={[styles.title, { color: archived ? colors.mutedForeground : colors.foreground }]}
              numberOfLines={2}
            >
              {idea.title}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={12} color={tint} />
            <Text style={[styles.metaText, { color: tint }]}>{meta.label}</Text>
            {typeof idea.estimatedCost === "number" && idea.estimatedCost > 0 ? (
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                · ~${idea.estimatedCost.toFixed(0)}/person
              </Text>
            ) : null}
            {archived ? (
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>· Archived</Text>
            ) : null}
          </View>
        </View>

        {/* Vote chip (pending) or frozen tally (confirmed/archived). */}
        {pending && onVote && !readOnly ? (
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onVote();
            }}
            style={[
              styles.voteBtn,
              {
                borderColor: idea.votedByMe ? colors.primary : colors.border,
                backgroundColor: idea.votedByMe ? colors.primary + "18" : "transparent",
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={idea.votedByMe ? "Remove your vote" : "Vote for this idea"}
          >
            <Ionicons
              name={idea.votedByMe ? "arrow-up-circle" : "arrow-up-circle-outline"}
              size={18}
              color={idea.votedByMe ? colors.primary : colors.mutedForeground}
            />
            <Text style={[styles.voteText, { color: idea.votedByMe ? colors.primary : colors.mutedForeground }]}>
              {idea.voteCount > 0 ? idea.voteCount : "Vote"}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.voteTally, { backgroundColor: colors.border + "55" }]}>
            <Ionicons name="arrow-up" size={12} color={colors.mutedForeground} />
            <Text style={[styles.voteTallyText, { color: colors.mutedForeground }]}>{idea.voteCount}</Text>
          </View>
        )}

        {/* Reorder arrows (inline reorder mode). */}
        {reordering && onMove ? (
          <View style={styles.moveCol}>
            <TouchableOpacity
              onPress={() => onMove("up")}
              disabled={!canMoveUp}
              hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
              style={{ opacity: canMoveUp ? 1 : 0.25 }}
              accessibilityLabel="Move idea up"
            >
              <Ionicons name="chevron-up" size={20} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onMove("down")}
              disabled={!canMoveDown}
              hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
              style={{ opacity: canMoveDown ? 1 : 0.25 }}
              accessibilityLabel="Move idea down"
            >
              <Ionicons name="chevron-down" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {idea.description ? (
        <Text style={[styles.desc, { color: colors.mutedForeground }]} numberOfLines={3}>
          {idea.description}
        </Text>
      ) : null}

      {idea.linkUrl ? (
        <TouchableOpacity onPress={openLink} style={styles.linkRow} accessibilityRole="link">
          <Ionicons name="link-outline" size={13} color={colors.blue} />
          <Text style={[styles.linkText, { color: colors.blue }]} numberOfLines={1}>
            {idea.linkUrl.replace(/^https?:\/\//, "")}
          </Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.bottomRow}>
        <View style={styles.attribution}>
          <UserAvatar initials={initials} color={tint} imageUrl={avatarUrl} size={18} fontSize={8} />
          <Text style={[styles.attributionText, { color: colors.textDim }]} numberOfLines={1}>
            Suggested by {submitterName}
          </Text>
        </View>
        {hasAnyAction && !reordering ? (
          <TouchableOpacity
            onPress={() => setActionsOpen((v) => !v)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Idea actions"
          >
            <Ionicons name={actionsOpen ? "close" : "ellipsis-horizontal"} size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        ) : null}
      </View>

      {actionsOpen && !reordering ? (
        <View style={[styles.actionsRow, { borderTopColor: colors.border }]}>
          {canManage && pending && onConfirm ? (
            <TouchableOpacity onPress={act(onConfirm)} style={[styles.actionBtn, { backgroundColor: colors.green + "1A" }]}>
              <Ionicons name="checkmark-circle" size={15} color={colors.green} />
              <Text style={[styles.actionText, { color: colors.green }]}>Confirm</Text>
            </TouchableOpacity>
          ) : null}
          {canManage && pending && onPin ? (
            <TouchableOpacity onPress={act(onPin)} style={[styles.actionBtn, { backgroundColor: colors.gold + "1A" }]}>
              <Ionicons name={idea.pinned ? "pin" : "pin-outline"} size={15} color={colors.gold} />
              <Text style={[styles.actionText, { color: colors.gold }]}>{idea.pinned ? "Unpin" : "Pin"}</Text>
            </TouchableOpacity>
          ) : null}
          {canManage && pending && onArchive ? (
            <TouchableOpacity onPress={act(onArchive)} style={[styles.actionBtn, { backgroundColor: colors.border + "55" }]}>
              <Ionicons name="archive-outline" size={15} color={colors.mutedForeground} />
              <Text style={[styles.actionText, { color: colors.mutedForeground }]}>Archive</Text>
            </TouchableOpacity>
          ) : null}
          {canManage && archived && onReactivate ? (
            <TouchableOpacity onPress={act(onReactivate)} style={[styles.actionBtn, { backgroundColor: colors.primary + "1A" }]}>
              <Ionicons name="refresh-outline" size={15} color={colors.primary} />
              <Text style={[styles.actionText, { color: colors.primary }]}>Reopen</Text>
            </TouchableOpacity>
          ) : null}
          {canManage && idea.status === "confirmed" && onUnconfirm ? (
            <TouchableOpacity onPress={act(onUnconfirm)} style={[styles.actionBtn, { backgroundColor: colors.border + "55" }]}>
              <Ionicons name="arrow-undo-outline" size={15} color={colors.mutedForeground} />
              <Text style={[styles.actionText, { color: colors.mutedForeground }]}>Back to ideas</Text>
            </TouchableOpacity>
          ) : null}
          {canEdit ? (
            <TouchableOpacity onPress={act(onEdit)} style={[styles.actionBtn, { backgroundColor: colors.border + "55" }]}>
              <Ionicons name="pencil-outline" size={15} color={colors.foreground} />
              <Text style={[styles.actionText, { color: colors.foreground }]}>Edit</Text>
            </TouchableOpacity>
          ) : null}
          {canDelete ? (
            <TouchableOpacity onPress={act(onDelete)} style={[styles.actionBtn, { backgroundColor: "#E5484D1A" }]}>
              <Ionicons name="trash-outline" size={15} color="#E5484D" />
              <Text style={[styles.actionText, { color: "#E5484D" }]}>Delete</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: 14, padding: 12, marginBottom: 10 },
  topRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  ideaBadge: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 1 },
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  title: { fontSize: 15, fontWeight: "800", flexShrink: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3, flexWrap: "wrap" },
  metaText: { fontSize: 11, fontWeight: "700" },
  voteBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1.5, borderRadius: 18, paddingHorizontal: 10, paddingVertical: 5 },
  voteText: { fontSize: 12, fontWeight: "800" },
  voteTally: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
  voteTallyText: { fontSize: 11, fontWeight: "800" },
  moveCol: { justifyContent: "center", gap: 2, marginLeft: 2 },
  desc: { fontSize: 13, lineHeight: 18, marginTop: 8 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 7 },
  linkText: { fontSize: 12, fontWeight: "600", flexShrink: 1 },
  bottomRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 9 },
  attribution: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  attributionText: { fontSize: 11, flexShrink: 1 },
  actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, borderTopWidth: 1, marginTop: 10, paddingTop: 10 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  actionText: { fontSize: 12, fontWeight: "700" },
});
