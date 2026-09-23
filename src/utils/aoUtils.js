/**
 * Sort adjoining owners (or any list with an address-like field) by
 * their street number, numerically - not alphabetically.
 *
 * Added 2026-09-22, on request, a real, long-standing (6-7 month)
 * complaint: every AO dropdown across the app was in whatever order
 * the data happened to come back in, never in numerical order by
 * house number. A plain alphabetical/string sort would still get this
 * wrong (e.g. "10" sorting before "2"), so this extracts the leading
 * number from the address and compares numerically; entries with no
 * leading number found sort to the end rather than breaking the sort.
 *
 * Usage: sortAOsNumerically(project.aos).map(ao => ...)
 * Works with any array of objects that have an address-like string
 * field - pass addressField if it isn't called "address".
 */
export function sortAOsNumerically(list, addressField) {
  if (!Array.isArray(list)) return list;
  const streetNumber = (item) => {
    const addr = (addressField && item?.[addressField])
      || item?.name || item?.premise || item?.address
      || item?.ao_address || item?.ao_premise_address
      || item?.reg_addr || item?.service_address || item?.serviceAddress || '';
    const match = String(addr).match(/^\s*(\d+)/);
    return match ? parseInt(match[1], 10) : Infinity;
  };
  return [...list].sort((a, b) => streetNumber(a) - streetNumber(b));
}
