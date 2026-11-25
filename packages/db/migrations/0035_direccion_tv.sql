-- Áreas de trabajo: permiso para configurar equipos y diseño, y rol Dirección TV.
UPDATE roles SET permissions = array(SELECT DISTINCT unnest(permissions || ARRAY['devices.configure']))
  WHERE key = 'admin';
--> statement-breakpoint
INSERT INTO roles (org_id, key, name, description, permissions, is_system)
SELECT o.id, 'direccion_tv', 'Dirección TV',
  'Realización y técnica: directo, rótulos, equipos, vídeos y cámaras',
  ARRAY['rundown.view','rundown.edit_structure','rundown.edit_cells','script.edit_any','live.go',
        'cg.fire','prompter.control','media.manage','station.admin','devices.configure','production.view'],
  true
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.org_id = o.id AND r.key = 'direccion_tv');
