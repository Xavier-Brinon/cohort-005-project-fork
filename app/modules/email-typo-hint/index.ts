import { correctDomainTypo } from "./lib/correct-domain-typo";

export function suggestEmailCorrection(email: string): string | null {
  return correctDomainTypo(email);
}
