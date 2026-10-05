import type { Contact, Deal, Profile, Property } from "@/types/db";
import type { DealEventInput } from "@/data/store";

/** Todo lo que necesitan las cards del deal room, armado una vez en la página. */
export interface Room {
  deal: Deal;
  property: Property | undefined;
  propertyTitle: string;
  client: Contact | undefined;
  ownerContact: Contact | undefined;
  profile: Profile;
  profiles: Profile[];
  /** Dueño/admin de la agencia. */
  isAdmin: boolean;
  /** Ve plata y datos legales: admin o responsable. Es visual: en localStorage no protege nada. */
  canSensitive: boolean;
  isSale: boolean;
  update: (patch: Partial<Deal>, event?: DealEventInput) => void;
}
