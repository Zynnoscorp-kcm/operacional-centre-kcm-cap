-- =============================================================================
-- 0019 — Aserción y verificación de cobertura de invariantes
-- Valida que el 100% de tablas en `kcm` tengan RLS y FORCE RLS, y que
-- los ledgers append-only tengan instalado el trigger `impedir_modificacion`.
-- =============================================================================

DO $$
DECLARE
  v_tabla record;
  v_sin_rls integer := 0;
  v_sin_force_rls integer := 0;
  v_ledger text;
  v_tiene_trigger integer;
  -- `errores` NO está aquí: conserva `resuelto_en`, que se actualiza cuando el
  -- error se cierra. Un ledger inmutable no admitiría esa transición.
  v_ledgers_inmutables text[] := ARRAY[
    'auditoria',
    'historial_sobrescritura_fecha',
    'liberacion',
    'acuse_liberacion_vba'
  ];
BEGIN
  -- 1. Verificar RLS en todas las tablas de kcm
  FOR v_tabla IN
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'kcm' AND c.relkind = 'r'
  LOOP
    IF NOT v_tabla.relrowsecurity THEN
      RAISE WARNING 'Tabla kcm.% no tiene ROW LEVEL SECURITY activado.', v_tabla.relname;
      v_sin_rls := v_sin_rls + 1;
    END IF;

    IF NOT v_tabla.relforcerowsecurity THEN
      RAISE WARNING 'Tabla kcm.% no tiene FORCE ROW LEVEL SECURITY activado.', v_tabla.relname;
      v_sin_force_rls := v_sin_force_rls + 1;
    END IF;
  END LOOP;

  IF v_sin_rls > 0 OR v_sin_force_rls > 0 THEN
    RAISE EXCEPTION 'Aserción de seguridad fallida: % tablas sin RLS, % tablas sin FORCE RLS.',
      v_sin_rls, v_sin_force_rls;
  END IF;

  -- 2. Verificar triggers de inmutabilidad en ledgers append-only
  FOREACH v_ledger IN ARRAY v_ledgers_inmutables
  LOOP
    SELECT COUNT(*) INTO v_tiene_trigger
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'kcm'
      AND c.relname = v_ledger
      AND t.tgname LIKE '%solo_agrega%';

    IF v_tiene_trigger = 0 THEN
      RAISE EXCEPTION 'Ledger kcm.% no tiene trigger de inmutabilidad instalado.', v_ledger;
    END IF;
  END LOOP;

  RAISE NOTICE 'Verificación de invariantes exitosa: 100%% RLS + FORCE RLS verificado, ledgers protegidos.';
END;
$$;
