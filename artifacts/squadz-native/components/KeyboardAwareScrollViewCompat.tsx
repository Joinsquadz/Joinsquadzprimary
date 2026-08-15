import {
  KeyboardAwareScrollView,
  KeyboardAwareScrollViewProps,
} from "react-native-keyboard-controller";
import { Platform, ScrollView, ScrollViewProps } from "react-native";

type Props = KeyboardAwareScrollViewProps & ScrollViewProps;

export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = "handled",
  ...props
}: Props) {
  if (Platform.OS === "web") {
    return (
      <ScrollView keyboardShouldPersistTaps={keyboardShouldPersistTaps} {...props}>
        {children}
      </ScrollView>
    );
  }
  return (
    <KeyboardAwareScrollView
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      {...props}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}

/**
 * `renderScrollComponent` for a `FlatList` whose rows contain text inputs
 * (the Vibe feed composer, inline post edits, comment boxes).
 *
 * A `FlatList` scrolls its own virtualized content, so wrapping it in a
 * keyboard-aware ScrollView does nothing — the list has to BE the aware
 * scroller. This is the integration the library documents for virtualized
 * lists. Web keeps the plain scroll component.
 */
export function renderKeyboardAwareScroll(props: ScrollViewProps) {
  return <KeyboardAwareScrollViewCompat bottomOffset={24} {...props} />;
}
