const DOMAIN_CORRECTIONS: ReadonlyMap<string, string> = new Map([
  ["gmial.com", "gmail.com"],
  ["gamil.com", "gmail.com"],
  ["hotmial.com", "hotmail.com"],
  ["outlok.com", "outlook.com"],
]);

export function correctDomainTypo(email: string): string | null {
  const address = email.trim().toLowerCase();
  const atIndex = address.indexOf("@");
  if (atIndex < 1 || address.includes("@", atIndex + 1)) {
    return null;
  }
  const corrected = DOMAIN_CORRECTIONS.get(address.slice(atIndex + 1));
  if (corrected === undefined) {
    return null;
  }
  return `${address.slice(0, atIndex)}@${corrected}`;
}
