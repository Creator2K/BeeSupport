export const riskSelectStyle =
  "border-input bg-background h-9 rounded-md border px-3 text-sm";

export function riskDateTimeValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
