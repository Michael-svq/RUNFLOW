-- Se ejecuta solo al crear el volumen de Postgres por primera vez.
-- Rol con el que se conecta la aplicación: NO es propietario de las tablas,
-- así que le aplica el aislamiento por empresa (RLS).
CREATE ROLE runflow_app LOGIN PASSWORD :'app_password';
