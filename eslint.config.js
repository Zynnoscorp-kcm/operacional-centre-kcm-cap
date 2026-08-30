/**
 * Linter de la plataforma.
 *
 * El alcance está acotado a `plataforma/`, que es el único árbol TypeScript.
 * Los paquetes compartidos y las herramientas son JavaScript puro y los revisa
 * `tools/check/proyecto.js`, que además comprueba cosas que ningún linter
 * genérico sabe: que Git no rastree material privado y que ningún `employeeId`
 * aparezca como número.
 */

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    // Todo lo que no es la plataforma queda fuera.
    ignores: ["**/*", "!plataforma/**"],
  },
  {
    files: ["plataforma/**/*.ts"],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Un `any` que se cuela deja de ser un tipo estricto sin que nadie lo note.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unnecessary-condition": "off",
      // Una promesa sin esperar en una ruta de liberación es un efecto que se
      // pierde en silencio. Aquí todavía no hay ninguna, y por eso conviene
      // fijar la regla antes de que la haya.
      //
      // `describe` e `it` de `node:test` devuelven promesa por diseño y no se
      // esperan: se declaran como excepción nominal en vez de apagar la regla en
      // las pruebas, para que una promesa de verdad olvidada dentro de una
      // prueba siga siendo un error.
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            {
              from: "package",
              package: "node:test",
              name: ["describe", "it", "test", "before", "after", "beforeEach", "afterEach"],
            },
          ],
        },
      ],
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      // El guion bajo delante marca «recibido y deliberadamente no usado», que es
      // la misma convención que ya respeta `noUnusedParameters` de TypeScript.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-console": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  prettier,
);
