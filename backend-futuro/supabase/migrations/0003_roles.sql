-- ============================================================================
-- 0003 · Roles del equipo
--
-- Va en su propio archivo porque Postgres no deja USAR un valor de enum en la
-- misma transacción en que se lo agrega. Los usa 0004.
--
-- owner          dueño de la agencia (uno o más)
-- admin          administración de la cuenta
-- gerente        visión completa, reportes y configuración
-- supervisor     aprueba excepciones y audita
-- resp_ventas    operaciones, reservas, informes y cierres de venta
-- resp_alquileres aprobación documental y contratos de alquiler
-- administrativo documentación, reservas, contratos y carga operativa
-- agente         leads, visitas, propiedades y tareas comerciales
-- ============================================================================

alter type user_role add value if not exists 'gerente';
alter type user_role add value if not exists 'supervisor';
alter type user_role add value if not exists 'resp_ventas';
alter type user_role add value if not exists 'resp_alquileres';
alter type user_role add value if not exists 'administrativo';
