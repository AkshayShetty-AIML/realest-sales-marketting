/**
 * BUILDER SERVICES — what we will offer a developer: services for their
 * buyers, and services for the developer. None is live yet: each is "Coming
 * soon", and the only thing a builder can do is ask to be told when it's ready.
 */

export interface BuilderService {
  id: string;
  title: string;
  what: string;
}

export const FOR_BUYERS: BuilderService[] = [
  { id: "buyer-home-finance", title: "Home finance", what: "Home-loan offers for your buyers from partner lenders, matched to the unit they're booking." },
  { id: "buyer-banking", title: "Banking", what: "Account opening and payment set-up for your buyers' booking and instalments." },
  { id: "buyer-legal", title: "Legal", what: "Independent lawyers who check the agreement and title for your buyers." },
  { id: "buyer-interiors", title: "Interiors", what: "Interior design and fit-out partners your buyers can book before handover." },
  { id: "buyer-insurance", title: "Insurance", what: "Home and loan insurance for your buyers." },
  { id: "buyer-paperwork", title: "Paperwork", what: "Help with registration, stamp duty and the documents your buyers need." },
];

export const FOR_DEVELOPERS: BuilderService[] = [
  { id: "dev-deposit-free-booking", title: "Deposit-free booking guarantee", what: "Buyers book for a small fee while the booking amount is guaranteed to you." },
  { id: "dev-escrow-collections", title: "Escrow-safe collections", what: "Buyer payments collected into escrow and released to you on agreed milestones." },
  { id: "dev-finance", title: "Developer finance", what: "Construction and project finance from partner lenders." },
  { id: "dev-marketing-sales", title: "We run your marketing and sales", what: "Our team runs your campaigns, enquiries and site visits on this desk, for you." },
];

export const SERVICE_IDS = [...FOR_BUYERS, ...FOR_DEVELOPERS].map((s) => s.id) as [string, ...string[]];
