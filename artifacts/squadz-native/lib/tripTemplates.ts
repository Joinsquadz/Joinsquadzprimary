import type { StopCategory } from "@/types";

/**
 * A trip template preloads a starter itinerary. Stops use a relative `dayIndex`
 * (0-based) that is materialized into concrete calendar days at create time
 * against the chosen start date. Templates are gated behind Squadz+.
 */
export type TemplateStop = {
  dayIndex: number;
  time: string;
  title: string;
  placeName: string;
  category: StopCategory;
};

export type TripTemplate = {
  id: string;
  emoji: string;
  title: string;
  tagline: string;
  coverStyle: string;
  /** Suggested length; the create form seeds the end date from this. */
  nights: number;
  stops: TemplateStop[];
};

export const TRIP_TEMPLATES: TripTemplate[] = [
  {
    id: "beach",
    emoji: "🏖️",
    title: "Beach Getaway",
    tagline: "Sun, sand & sunset dinners",
    coverStyle: "ocean",
    nights: 3,
    stops: [
      { dayIndex: 0, time: "3:00 PM", title: "Check in", placeName: "Beachfront rental", category: "lodging" },
      { dayIndex: 0, time: "7:00 PM", title: "Welcome dinner", placeName: "Seafood spot", category: "food" },
      { dayIndex: 1, time: "10:00 AM", title: "Beach day", placeName: "Main beach", category: "activity" },
      { dayIndex: 1, time: "6:00 PM", title: "Sunset drinks", placeName: "Rooftop bar", category: "food" },
      { dayIndex: 2, time: "11:00 AM", title: "Snorkeling", placeName: "Reef cove", category: "activity" },
      { dayIndex: 3, time: "11:00 AM", title: "Check out", placeName: "Beachfront rental", category: "lodging" },
    ],
  },
  {
    id: "ski",
    emoji: "🎿",
    title: "Ski Weekend",
    tagline: "Powder days & cozy nights",
    coverStyle: "night",
    nights: 2,
    stops: [
      { dayIndex: 0, time: "4:00 PM", title: "Arrive & rent gear", placeName: "Rental shop", category: "travel" },
      { dayIndex: 0, time: "7:30 PM", title: "Group dinner", placeName: "Lodge restaurant", category: "food" },
      { dayIndex: 1, time: "8:30 AM", title: "First lifts", placeName: "Main mountain", category: "activity" },
      { dayIndex: 1, time: "8:00 PM", title: "Après-ski", placeName: "Slope-side bar", category: "food" },
      { dayIndex: 2, time: "9:00 AM", title: "Half day on slopes", placeName: "Main mountain", category: "activity" },
    ],
  },
  {
    id: "city",
    emoji: "🏙️",
    title: "City Break",
    tagline: "Food, sights & nightlife",
    coverStyle: "berry",
    nights: 2,
    stops: [
      { dayIndex: 0, time: "2:00 PM", title: "Hotel check in", placeName: "Downtown hotel", category: "lodging" },
      { dayIndex: 0, time: "8:00 PM", title: "Night out", placeName: "Old town", category: "activity" },
      { dayIndex: 1, time: "10:00 AM", title: "Museum & landmarks", placeName: "City center", category: "activity" },
      { dayIndex: 1, time: "1:00 PM", title: "Lunch", placeName: "Local market", category: "food" },
      { dayIndex: 2, time: "11:00 AM", title: "Brunch & shopping", placeName: "Main street", category: "food" },
    ],
  },
  {
    id: "camping",
    emoji: "🏕️",
    title: "Camping Trip",
    tagline: "Trails, campfires & stars",
    coverStyle: "forest",
    nights: 2,
    stops: [
      { dayIndex: 0, time: "1:00 PM", title: "Set up camp", placeName: "Campground", category: "lodging" },
      { dayIndex: 0, time: "7:00 PM", title: "Campfire dinner", placeName: "Fire pit", category: "food" },
      { dayIndex: 1, time: "9:00 AM", title: "Day hike", placeName: "Summit trail", category: "activity" },
      { dayIndex: 1, time: "8:00 PM", title: "Stargazing", placeName: "Open field", category: "activity" },
      { dayIndex: 2, time: "10:00 AM", title: "Pack up", placeName: "Campground", category: "lodging" },
    ],
  },
];

export function getTemplate(id: string | undefined | null): TripTemplate | undefined {
  return TRIP_TEMPLATES.find((t) => t.id === id);
}
