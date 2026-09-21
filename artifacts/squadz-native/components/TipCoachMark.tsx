import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context";
import {
  useTips,
  type SquadAnchorKey,
  type TipLayout,
} from "@/context/TipsContext";
import { TAB_BAR_HEIGHT } from "@/constants/layout";

const CARD_W = 220;
const ORANGE = "#FF6B2C";
const SURFACE = "#1A1A1A";
const ARROW = 8;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

type CardPos = {
  cardTop: number;
  cardLeft: number;
  arrowDir: "up" | "down";
  arrowLeft: number;
};

// Position a card above/below a measured anchor, clamped to the screen.
function positionFromAnchor(
  layout: TipLayout,
  cardH: number,
  win: { width: number; height: number },
  insets: EdgeInsets,
): CardPos {
  const centerX = layout.x + layout.width / 2;
  const cardLeft = clamp(centerX - CARD_W / 2, 12, win.width - CARD_W - 12);
  const spaceBelow =
    win.height - (layout.y + layout.height) - insets.bottom - TAB_BAR_HEIGHT;
  let cardTop: number;
  let arrowDir: "up" | "down";
  if (spaceBelow > cardH + ARROW + 16) {
    cardTop = layout.y + layout.height + ARROW + 4;
    arrowDir = "up";
  } else {
    cardTop = clamp(layout.y - cardH - ARROW - 4, insets.top + 12, win.height);
    arrowDir = "down";
  }
  const arrowLeft = clamp(centerX - cardLeft - ARROW, 16, CARD_W - 16 - ARROW * 2);
  return { cardTop, cardLeft, arrowDir, arrowLeft };
}

type CardContentProps = {
  pos: CardPos;
  headline: string;
  body: string;
  /** Footer left: e.g. "2 of 5". Omit for standalone tips. */
  progress?: string;
  primaryLabel: string;
  onPrimary: () => void;
  onClose: () => void;
  onCardLayout: (h: number) => void;
};

function TipCard({
  pos,
  headline,
  body,
  progress,
  primaryLabel,
  onPrimary,
  onClose,
  onCardLayout,
}: CardContentProps) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View
        onLayout={(e) => onCardLayout(e.nativeEvent.layout.height)}
        style={[styles.card, { top: pos.cardTop, left: pos.cardLeft, width: CARD_W }]}
      >
        {pos.arrowDir === "up" && <View style={[styles.arrowUp, { left: pos.arrowLeft }]} />}

        <View style={styles.headerRow}>
          <Text style={styles.headline}>{headline}</Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={16} color="#9A9A9A" />
          </TouchableOpacity>
        </View>

        <Text style={styles.body}>{body}</Text>

        <View style={[styles.footerRow, !progress && styles.footerRowEnd]}>
          {progress ? <Text style={styles.progress}>{progress}</Text> : null}
          <TouchableOpacity onPress={onPrimary} style={styles.nextBtn} activeOpacity={0.85}>
            <Text style={styles.nextText}>{primaryLabel}</Text>
          </TouchableOpacity>
        </View>

        {pos.arrowDir === "down" && <View style={[styles.arrowDown, { left: pos.arrowLeft }]} />}
      </View>
    </View>
  );
}

/**
 * Global onboarding coach-mark overlay. Renders nothing unless a tip is active.
 *
 * Renders the sequential first-run tour, driven by `activeIndex`.
 * Mounted once at the root so it can float above any screen.
 */
export function TipCoachMark() {
  const {
    activeIndex,
    tips,
    anchors,
    next,
    dismiss,
  } = useTips();
  const insets = useSafeAreaInsets();
  const [cardH, setCardH] = useState(132);

  const win = Dimensions.get("window");

  if (activeIndex === null) return null;
  const tip = tips[activeIndex];
  if (!tip) return null;

  const isLast = activeIndex === tips.length - 1;
  const progress = `${activeIndex + 1} of ${tips.length}`;
  const primaryLabel = isLast ? "Done" : "Next";

  let pos: CardPos;
  if (tip.place === "feedTab") {
    // Feed is the 5th of 5 visible tabs — point at its horizontal centre.
    const tabCount = 5;
    const feedCenter = win.width * ((4 + 0.5) / tabCount);
    const cardLeft = clamp(feedCenter - CARD_W / 2, 12, win.width - CARD_W - 12);
    const barTop = win.height - insets.bottom - TAB_BAR_HEIGHT;
    const cardTop = clamp(barTop - cardH - ARROW - 8, insets.top + 12, win.height);
    const arrowLeft = clamp(feedCenter - cardLeft - ARROW, 16, CARD_W - 16 - ARROW * 2);
    pos = { cardTop, cardLeft, arrowDir: "down", arrowLeft };
  } else {
    const key = tip.target as SquadAnchorKey;
    const layout = anchors[key];
    if (!layout) return null; // wait until the anchor has been measured
    pos = positionFromAnchor(layout, cardH, win, insets);
  }

  return (
    <TipCard
      pos={pos}
      headline={tip.headline}
      body={tip.body}
      progress={progress}
      primaryLabel={primaryLabel}
      onPrimary={next}
      onClose={dismiss}
      onCardLayout={setCardH}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    backgroundColor: SURFACE,
    borderRadius: 14,
    padding: 14,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#2C2C2C",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  headline: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 19,
  },
  body: {
    color: "#C9C9C9",
    fontSize: 12.5,
    lineHeight: 17,
    marginTop: 6,
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
  },
  footerRowEnd: {
    justifyContent: "flex-end",
  },
  progress: {
    color: "#7A7A7A",
    fontSize: 11,
    fontWeight: "700",
  },
  nextBtn: {
    backgroundColor: ORANGE,
    borderRadius: 9,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  nextText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  arrowUp: {
    position: "absolute",
    top: -ARROW,
    width: 0,
    height: 0,
    borderLeftWidth: ARROW,
    borderRightWidth: ARROW,
    borderBottomWidth: ARROW,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: SURFACE,
  },
  arrowDown: {
    position: "absolute",
    bottom: -ARROW,
    width: 0,
    height: 0,
    borderLeftWidth: ARROW,
    borderRightWidth: ARROW,
    borderTopWidth: ARROW,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: SURFACE,
  },
});
