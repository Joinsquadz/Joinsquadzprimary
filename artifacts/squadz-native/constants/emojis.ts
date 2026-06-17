// Shared icon choices for squads and events. Curated, de-duplicated, and
// grouped (vibes → sports & fitness → games & hobbies → food & drink →
// travel & outdoors → home/work/misc) so people can find things like golf,
// the gym, tennis, hiking, etc. Used by the squad/event create + edit screens
// so every picker offers the same rich set.
//
// EMOJI_CATEGORIES is the single source of truth. Each entry carries search
// keywords so the icon picker can match "ball", "food", "gym", etc.
// EMOJI_CHOICES (flat list) and CURATED_EMOJIS (quick picks) are derived from
// it, so there is no risk of the lists drifting apart.

export type EmojiEntry = { emoji: string; keywords: string };
export type EmojiCategory = { label: string; items: EmojiEntry[] };

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    label: "Vibes",
    items: [
      { emoji: "🔥", keywords: "fire hot lit vibe" },
      { emoji: "🎉", keywords: "party celebrate tada" },
      { emoji: "🎊", keywords: "party confetti celebrate" },
      { emoji: "✨", keywords: "sparkle shine magic" },
      { emoji: "⭐", keywords: "star favorite" },
      { emoji: "💯", keywords: "hundred perfect score" },
      { emoji: "🌈", keywords: "rainbow pride" },
      { emoji: "💫", keywords: "dizzy star sparkle" },
    ],
  },
  {
    label: "Sports & Fitness",
    items: [
      { emoji: "⚽", keywords: "soccer football ball" },
      { emoji: "🏀", keywords: "basketball ball hoops" },
      { emoji: "🏈", keywords: "football ball" },
      { emoji: "⚾", keywords: "baseball ball" },
      { emoji: "🎾", keywords: "tennis ball" },
      { emoji: "🏐", keywords: "volleyball ball" },
      { emoji: "🏉", keywords: "rugby ball" },
      { emoji: "⛳", keywords: "golf flag" },
      { emoji: "🏌️", keywords: "golf golfer" },
      { emoji: "🏋️", keywords: "gym lift weights workout" },
      { emoji: "🤸", keywords: "gymnastics cartwheel" },
      { emoji: "🧘", keywords: "yoga meditate calm" },
      { emoji: "🏃", keywords: "run running jog" },
      { emoji: "🚴", keywords: "bike cycling ride" },
      { emoji: "🏊", keywords: "swim swimming pool" },
      { emoji: "🏄", keywords: "surf surfing wave" },
      { emoji: "⛷️", keywords: "ski skiing snow" },
      { emoji: "🏂", keywords: "snowboard snow" },
      { emoji: "🥾", keywords: "hike hiking boot trail" },
      { emoji: "🧗", keywords: "climb climbing rock" },
      { emoji: "🛹", keywords: "skate skateboard" },
      { emoji: "🥊", keywords: "box boxing gloves" },
      { emoji: "🎿", keywords: "ski skis snow" },
      { emoji: "🎳", keywords: "bowling" },
      { emoji: "🎱", keywords: "pool billiards 8 ball" },
      { emoji: "♟️", keywords: "chess strategy" },
    ],
  },
  {
    label: "Games & Hobbies",
    items: [
      { emoji: "🎮", keywords: "game gaming controller video" },
      { emoji: "🎲", keywords: "dice board game" },
      { emoji: "🎯", keywords: "darts target bullseye" },
      { emoji: "🕹️", keywords: "arcade joystick retro" },
      { emoji: "🃏", keywords: "cards joker poker" },
      { emoji: "🎨", keywords: "art paint craft draw" },
      { emoji: "📷", keywords: "photo camera pics" },
      { emoji: "🎣", keywords: "fish fishing" },
      { emoji: "🎸", keywords: "guitar music band rock" },
      { emoji: "🎤", keywords: "sing karaoke mic" },
      { emoji: "🎵", keywords: "music note song" },
      { emoji: "🎧", keywords: "headphones music listen" },
      { emoji: "🎬", keywords: "movie film cinema" },
      { emoji: "🍿", keywords: "popcorn movie snack" },
      { emoji: "📚", keywords: "books read book club study" },
      { emoji: "🎓", keywords: "grad school study graduation" },
    ],
  },
  {
    label: "Food & Drink",
    items: [
      { emoji: "🍕", keywords: "pizza food dinner" },
      { emoji: "🍔", keywords: "burger food lunch" },
      { emoji: "🌮", keywords: "taco food mexican" },
      { emoji: "🍣", keywords: "sushi food japanese" },
      { emoji: "🍜", keywords: "ramen noodles food soup" },
      { emoji: "🍩", keywords: "donut food sweet" },
      { emoji: "🍰", keywords: "cake dessert food sweet" },
      { emoji: "☕", keywords: "coffee drink cafe" },
      { emoji: "🍻", keywords: "beer drink cheers bar" },
      { emoji: "🍷", keywords: "wine drink" },
      { emoji: "🥂", keywords: "cheers drink champagne toast" },
      { emoji: "🍳", keywords: "brunch eggs food breakfast" },
    ],
  },
  {
    label: "Travel & Outdoors",
    items: [
      { emoji: "✈️", keywords: "travel plane flight trip" },
      { emoji: "🏖️", keywords: "beach vacation sand" },
      { emoji: "🌊", keywords: "ocean wave water sea" },
      { emoji: "🏕️", keywords: "camp camping outdoors" },
      { emoji: "🗺️", keywords: "map trip adventure" },
      { emoji: "🏔️", keywords: "mountain peak hike" },
      { emoji: "🌅", keywords: "sunrise sunset view" },
      { emoji: "🚗", keywords: "car road trip drive" },
      { emoji: "⛺", keywords: "tent camp camping" },
    ],
  },
  {
    label: "Home & Misc",
    items: [
      { emoji: "🏠", keywords: "home house roommates" },
      { emoji: "💼", keywords: "work business coworkers office" },
      { emoji: "💪", keywords: "strong gym flex workout" },
      { emoji: "🐶", keywords: "dog pet puppy" },
      { emoji: "🐱", keywords: "cat pet kitten" },
      { emoji: "🎂", keywords: "birthday cake party" },
      { emoji: "🎄", keywords: "christmas holiday tree" },
      { emoji: "💍", keywords: "ring wedding engaged" },
      { emoji: "👶", keywords: "baby kids family" },
    ],
  },
];

// Flat list of every icon, in category order. Kept for screens that render the
// whole set (squad/event edit) and for backward compatibility.
export const EMOJI_CHOICES = EMOJI_CATEGORIES.flatMap((c) => c.items.map((i) => i.emoji));

// The 8 quick picks shown inline on the create screens before "More" opens the
// full searchable sheet — one strong representative per major category.
export const CURATED_EMOJIS = ["🔥", "🎉", "⚽", "🎮", "🍕", "✈️", "🎵", "🎨"];
