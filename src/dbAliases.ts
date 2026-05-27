/**
 * Domain row aliases from generated Supabase `Database` types.
 */
import type { Database } from './types';

export type Profile = Database['public']['Tables']['profiles']['Row'];
export type Group = Database['public']['Tables']['groups']['Row'];
export type Expense = Database['public']['Tables']['expenses']['Row'];
export type Event = Database['public']['Tables']['events']['Row'];
export type EventParticipant = Database['public']['Tables']['event_participants']['Row'];
export type UserContact = Database['public']['Tables']['user_contacts']['Row'];
