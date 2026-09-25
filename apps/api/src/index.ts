import { PACKAGE_NAME } from "@prep/core";

/** API scaffold — Express, auth, and jobs arrive in Phase 4. */
const PORT = Number(process.env.PORT ?? 4000);

console.log(
  `API scaffold listening intent on :${PORT} (core=${PACKAGE_NAME}). Express lands in T17a.`,
);
