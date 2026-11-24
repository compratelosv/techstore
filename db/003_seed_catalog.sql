-- TechStore · catálogo demo (productos de tecnología inventados)

insert into ts_categories (slug, name, sort_order) values
  ('laptops','Laptops',1),
  ('smartphones','Smartphones',2),
  ('audio','Audio',3),
  ('accesorios','Accesorios',4),
  ('monitores','Monitores',5),
  ('almacenamiento','Almacenamiento',6)
on conflict (slug) do nothing;

insert into ts_products (sku, name, description, brand, category_id, price, cost, stock, low_stock, image_url)
select v.sku, v.name, v.description, v.brand, c.id, v.price, v.cost, v.stock, 3,
       'assets/img/' || lower(v.sku) || '.svg'
from (values
  ('LAP-101','NovaBook Air 13','Ultrabook 13" de 1.1 kg, 16 GB RAM, 512 GB SSD, pantalla 2.5K.','NovaTech', 'laptops', 849.00, 620.00, 12),
  ('LAP-102','NovaBook Pro 15','Portátil creador 15", Ryzen 9, 32 GB RAM, RTX 4060.','NovaTech', 'laptops', 1499.00, 1120.00, 6),
  ('LAP-103','Zenith Gamer 16','Gaming 16" 165 Hz, Core i7, 16 GB, 1 TB SSD.','Zenith', 'laptops', 1299.00, 980.00, 4),
  ('LAP-104','Lumen Flex 14','Convertible 2 en 1 con lápiz digital incluido, 8 GB, 256 GB.','Lumen', 'laptops', 699.00, 510.00, 9),
  ('PHN-201','Pulse X5','Smartphone 6.5" AMOLED, 128 GB, cámara 64 MP, 5000 mAh.','Pulse', 'smartphones', 349.00, 240.00, 18),
  ('PHN-202','Pulse X5 Pro','6.8" 120 Hz, 256 GB, triple cámara 108 MP, carga 65 W.','Pulse', 'smartphones', 549.00, 390.00, 10),
  ('PHN-203','Orbit Mini','Compacto 5.9", 128 GB, resistente al agua IP68.','Orbit', 'smartphones', 289.00, 200.00, 22),
  ('PHN-204','Orbit Max','Batería 6000 mAh, 256 GB, pantalla 6.7" 90 Hz.','Orbit', 'smartphones', 419.00, 300.00, 14),
  ('AUD-301','Sonus Pods 3','Audífonos TWS con cancelación activa y estuche de carga.','Sonus', 'audio', 79.00, 42.00, 40),
  ('AUD-302','Sonus Studio Over-Ear','Diadema con ANC híbrido, 40 h de batería, plegable.','Sonus', 'audio', 149.00, 95.00, 16),
  ('AUD-303','Bassline Buds','TWS deportivos, ganchos de silicona, IPX7.','Bassline', 'audio', 45.00, 24.00, 55),
  ('AUD-304','Klang Bar 200','Barra de sonido 2.1 con subwoofer inalámbrico, HDMI ARC.','Klang', 'audio', 219.00, 150.00, 8),
  ('ACC-401','HubLink 7 en 1','Hub USB-C: HDMI 4K, 3 USB-A, SD/microSD, PD 100 W.','HubLink', 'accesorios', 39.00, 18.00, 70),
  ('ACC-402','IronKey Cargador 65W','Cargador GaN 65 W con dos puertos USB-C y uno USB-A.','IronKey', 'accesorios', 35.00, 17.00, 60),
  ('ACC-403','Glide Mouse Pro','Mouse inalámbrico 26 000 DPI, 70 h de batería.','Glide', 'accesorios', 49.00, 26.00, 33),
  ('ACC-404','Glide Mechanical TKL','Teclado mecánico TKL, switches rojos, RGB por tecla.','Glide', 'accesorios', 89.00, 52.00, 21),
  ('ACC-405','Mochila Shield 15.6','Mochila antirrobo con compartimento acolchado y puerto USB.','Shield', 'accesorios', 59.00, 30.00, 25),
  ('MON-501','Vista 27 QHD','Monitor 27" QHD 165 Hz, IPS, HDR400, altura ajustable.','Vista', 'monitores', 329.00, 235.00, 11),
  ('MON-502','Vista 24 FHD','Monitor 24" FHD 100 Hz, bordes finos, HDMI y DisplayPort.','Vista', 'monitores', 159.00, 105.00, 19),
  ('MON-503','Vista Ultrawide 34','34" ultrawide 3440x1440, 100 Hz, curva 1500R.','Vista', 'monitores', 549.00, 405.00, 5),
  ('STO-601','FlashDrive 128','USB-C 3.2 de 128 GB, lectura 400 MB/s.','DataCore', 'almacenamiento', 29.00, 14.00, 48),
  ('STO-602','DataCore SSD 1TB','SSD NVMe Gen4 1 TB, 7000 MB/s de lectura.','DataCore', 'almacenamiento', 109.00, 72.00, 27),
  ('STO-603','DataCore SSD 2TB','SSD NVMe Gen4 2 TB con disipador.','DataCore', 'almacenamiento', 189.00, 135.00, 9),
  ('STO-604','BackupBox 2TB','Disco externo 2 TB USB 3.2, cifrado por hardware.','DataCore', 'almacenamiento', 89.00, 58.00, 15)
) as v(sku, name, description, brand, cat_slug, price, cost, stock)
join ts_categories c on c.slug = v.cat_slug
on conflict (sku) do nothing;

insert into ts_shipping_zones (name, cost, free_over, active) values
  ('San Salvador',        3.50, 75.00, true),
  ('La Libertad',         4.00, 75.00, true),
  ('Santa Ana',           5.00, 90.00, true),
  ('San Miguel',          6.50, 100.00, true),
  ('Resto del país',      6.00, 100.00, true)
on conflict do nothing;

select
  (select count(*) from ts_categories) as categorias,
  (select count(*) from ts_products) as productos,
  (select count(*) from ts_shipping_zones) as zonas;
