---
name: cadbos-numeric-display
description: >
  Numeric display rules for the Cadbos UI. Load when adding or changing statistics,
  numeric inputs, currency amounts, measurements, chart values, or numeric table cells.
---

# Cadbos numeric display

Apply these rules to quantitative values in every UI locale:

- **Alignment:** Right-align standalone numeric values in their containers,
  including statistics, numeric inputs, chart value labels, and table cells.
  Align numeric column headings with the values beneath them. Numbers embedded
  in prose remain in normal text flow.
- **Decimal separator:** Use `.` for the decimal separator.
- **Thousands separators:** Group digits in threes, using the separator
  determined by the displayed value:
  - If a fractional part is displayed, use `,` between groups: `1,234.56`.
  - If no fractional part is displayed, use a space between groups: `1 234`.
  - Apply the same convention to quantitative values in prose.
- **Currency:** Put a space between the currency symbol and amount: `$
  1,234.50`, `₽ 1,234.50`. Format the amount’s separators using the rules
  above.
- **Locale consistency:** Keep these numeric conventions identical across UI
  locales. Translated labels and surrounding text may follow the active locale.
- **Exceptions:** Dates, times, identifiers, and other non-quantity strings are
  not numeric quantities; preserve their appropriate formatting. Do not
  reformat digits that are part of an identifier.
