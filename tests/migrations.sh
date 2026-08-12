#!/bin/bash
# Migration dry-run against real Postgres. Asserts what the data becomes, that
# nothing is invented, and that a second run changes nothing.
D=/tmp/mlpg
Q="psql -h $D/sock -p 54329 -U postgres -d mig -tAq"
psql -h $D/sock -p 54329 -U postgres -q -c "DROP DATABASE IF EXISTS mig" >/dev/null 2>&1
psql -h $D/sock -p 54329 -U postgres -q -c "CREATE DATABASE mig" >/dev/null
pass=0; fail=0
ck() { if [ "$2" = "$3" ]; then echo "  ok   $1"; pass=$((pass+1));
       else echo " FAIL  $1  expected=[$3] got=[$2]"; fail=$((fail+1)); fi; }

psql -h $D/sock -p 54329 -U postgres -d mig -q <<'SQL'
CREATE TABLE suppliers (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE stock_vehicles (id BIGSERIAL PRIMARY KEY, make TEXT, model TEXT, trim TEXT,
  price NUMERIC DEFAULT 0, quantity INT NOT NULL DEFAULT 0, notes TEXT DEFAULT '',
  colors JSONB DEFAULT '[]'::jsonb, units JSONB DEFAULT '[]'::jsonb);
-- supplier_id already present and unconstrained, as it is on the live database
CREATE TABLE purchase_orders (id BIGSERIAL PRIMARY KEY, po_number TEXT UNIQUE NOT NULL,
  supplier TEXT DEFAULT '', supplier_id BIGINT, items JSONB DEFAULT '[]'::jsonb);
INSERT INTO suppliers (name) VALUES ('Yu Motors'), ('Uniland'), ('  Weifang ');
INSERT INTO stock_vehicles (make, model, quantity, colors, units) VALUES
  ('BYD','Seal',   5, '[{"name":"White","qty":3},{"name":"Black","qty":2}]', '[]'),
  ('BYD','Atto',   0, '[{"name":"Red","qty":4}]',                            '[]'),
  ('BYD','Dolphin',0, '[]',                                                  '[]'),
  ('BYD','Han',    9, '[]', '[{"vin":"V1","supplier":"Yu Motors"},{"vin":"V2","supplier":"yu motors"},{"vin":"V3","supplier":"Nobody Ltd"},{"vin":"V4"}]');
INSERT INTO purchase_orders (po_number, supplier) VALUES
  ('PO-1','Yu Motors'), ('PO-2','UNILAND'), ('PO-3','Ghost Trading'), ('PO-4','');
SQL

psql -h $D/sock -p 54329 -U postgres -d mig -q -v ON_ERROR_STOP=1 -f migrations/005_stock_vin.sql >/dev/null || exit 1
psql -h $D/sock -p 54329 -U postgres -d mig -q -v ON_ERROR_STOP=1 -f migrations/006_supplier_catalogue.sql >/dev/null || exit 1

ck "a counted model keeps its figure as a prompt, not as stock" \
   "$($Q -c "SELECT quantity||'/'||legacy_count FROM stock_vehicles WHERE model='Seal'")" "0/5"
ck "a colour-only tally is captured too" \
   "$($Q -c "SELECT quantity||'/'||legacy_count FROM stock_vehicles WHERE model='Atto'")" "0/4"
ck "a model that never had stock raises no warning" \
   "$($Q -c "SELECT coalesce(legacy_count::text,'null') FROM stock_vehicles WHERE model='Dolphin'")" "null"
ck "a model with real cars is corrected to the number of cars" \
   "$($Q -c "SELECT quantity||'/'||coalesce(legacy_count::text,'null') FROM stock_vehicles WHERE model='Han'")" "4/null"
ck "no cars were invented" \
   "$($Q -c "SELECT sum(jsonb_array_length(units)) FROM stock_vehicles")" "4"
ck "no rows were lost" "$($Q -c "SELECT count(*) FROM stock_vehicles")" "4"

ck "purchase orders match by name, case-insensitively" \
   "$($Q -c "SELECT count(*) FROM purchase_orders WHERE supplier_id IS NOT NULL")" "2"
ck "an unknown supplier is left null rather than guessed" \
   "$($Q -c "SELECT coalesce(supplier_id::text,'null') FROM purchase_orders WHERE po_number='PO-3'")" "null"
ck "units match by name, case-insensitively" \
   "$($Q -c "SELECT count(*) FROM stock_vehicles sv, jsonb_array_elements(sv.units) u WHERE u->>'supplier_id' IS NOT NULL")" "2"
ck "a unit naming an unknown supplier stays unattributed" \
   "$($Q -c "SELECT count(*) FROM stock_vehicles sv, jsonb_array_elements(sv.units) u WHERE u->>'supplier'='Nobody Ltd' AND u->>'supplier_id' IS NULL")" "1"
ck "a unit with no supplier is untouched" \
   "$($Q -c "SELECT count(*) FROM stock_vehicles sv, jsonb_array_elements(sv.units) u WHERE u->>'vin'='V4' AND NOT (u ? 'supplier_id')")" "1"
ck "a pre-existing supplier_id still gets its foreign key" \
   "$($Q -c "SELECT count(*) FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu USING (constraint_name) WHERE tc.constraint_type='FOREIGN KEY' AND kcu.table_name='purchase_orders' AND kcu.column_name='supplier_id'")" "1"
ck "the new tables exist" \
   "$($Q -c "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('supplier_vehicles','supplier_docs')")" "2"

# ── Running both again must be a no-op ──
BEFORE=$($Q -c "SELECT md5(string_agg(t::text,'|' ORDER BY t::text)) FROM (SELECT id,quantity,legacy_count,units FROM stock_vehicles) t")
psql -h $D/sock -p 54329 -U postgres -d mig -q -v ON_ERROR_STOP=1 -f migrations/005_stock_vin.sql >/dev/null
psql -h $D/sock -p 54329 -U postgres -d mig -q -v ON_ERROR_STOP=1 -f migrations/006_supplier_catalogue.sql >/dev/null
AFTER=$($Q -c "SELECT md5(string_agg(t::text,'|' ORDER BY t::text)) FROM (SELECT id,quantity,legacy_count,units FROM stock_vehicles) t")
ck "applying both a second time changes nothing" "$AFTER" "$BEFORE"

echo ""
echo "$pass/$((pass+fail)) passed"
[ "$fail" = "0" ]
