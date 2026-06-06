export type InviteContext = {
  code: string;
  title: string;
  emoji: string;
  host: string;
  type: "event" | "squad";
  dest: string;
};

let _invite: InviteContext | null = null;

export const inviteStore = {
  set: (ctx: InviteContext) => { _invite = ctx; },
  get: (): InviteContext | null => _invite,
  clear: () => { _invite = null; },
};
