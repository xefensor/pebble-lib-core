# Core 0.5.1 optimization validation

Additive status-only context decoding retains 12 bytes instead of a five-record
private context copy. The complete packet is still validated before writing the
small output. Invalid reads leave output unchanged; hosts own failure clearing.

Validation: 130 JavaScript tests, five strict portable C suites including all
four wire versions, discarded-private-role rejection, unchanged output on
failure, original freshness/expiry and empty phone status. SDK4.33.1 Emery
library build passed. 18 release-helper tests also pass.

No physical-watch CPU, battery or peak memory measurements are claimed. Dynamic
provides consumer native size, memory and pixel evidence separately.
