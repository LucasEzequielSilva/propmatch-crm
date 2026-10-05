import { crmDb } from "./db.js";
import { openToken } from "./crypto.js";

export type ChannelName = "whatsapp" | "instagram" | "messenger";

export interface AccountRow {
  id: string;
  agency_id: string;
  channel: ChannelName;
  status: string;
  display_name: string | null;
  display_phone: string | null;
  username: string | null;
  business_id: string | null;
  waba_id: string | null;
  phone_number_id: string | null;
  page_id: string | null;
  ig_user_id: string | null;
  coexistence: boolean;
  access_token_enc: string | null;
}

const COLS =
  "id, agency_id, channel, status, display_name, display_phone, username, business_id, waba_id, phone_number_id, page_id, ig_user_id, coexistence, access_token_enc";

/** Cuenta activa por id externo (lo que viene en el webhook). */
export async function accountByExternal(
  channel: ChannelName,
  column: "phone_number_id" | "page_id" | "ig_user_id",
  value: string,
): Promise<AccountRow | null> {
  const { data, error } = await crmDb()
    .from("channel_accounts")
    .select(COLS)
    .eq("channel", channel)
    .eq(column, value)
    .neq("status", "disconnected")
    .limit(1);
  if (error) throw new Error("db");
  return (data?.[0] as AccountRow | undefined) ?? null;
}

export async function accountById(id: string, agencyId: string): Promise<AccountRow | null> {
  const { data, error } = await crmDb()
    .from("channel_accounts")
    .select(COLS)
    .eq("id", id)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (error) throw new Error("db");
  return (data as AccountRow | null) ?? null;
}

export function tokenOf(a: AccountRow): string {
  if (!a.access_token_enc) throw new Error("no_token");
  return openToken(a.access_token_enc);
}

export async function markNeedsReauth(accountId: string): Promise<void> {
  await crmDb().from("channel_accounts").update({ status: "needs_reauth", last_error: "token_invalido" }).eq("id", accountId);
}
