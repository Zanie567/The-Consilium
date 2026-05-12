import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".claude/**",
    ".vercel/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "node_modules/**",
    // Prisma scripts are Node.js scripts, not React modules: console.log is expected.
    "prisma/**",
  ]),
  {
    rules: {
      // Disallow leftover debug logs. Intentional server-side logging (API routes,
      // lib/email.ts) is acceptable because those files never run in the browser.
      "no-console": ["warn", { allow: ["warn", "error"] }],

      // Disallow `any`: use `unknown` with a type guard instead.
      "@typescript-eslint/no-explicit-any": "error",

      // React prop-types is unnecessary with TypeScript interfaces.
      "react/prop-types": "off",

      // Unused variables are dead code. Prefix with `_` to mark intentional ignores.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // The set-state-in-effect rule flags the standard Next.js SSR hydration pattern
      // (`useEffect(() => setMounted(true), [])`). These are safe and intentional.
      "react-hooks/set-state-in-effect": "off",

      // The error-boundaries rule forbids JSX inside try/catch. In server components
      // and API route handlers this pattern is fine: only disable in those contexts
      // via inline comments where needed.
      "react-hooks/error-boundaries": "off",
    },
  },
]);

export default eslintConfig;
