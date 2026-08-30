from pathlib import Path

path = Path('src/components/views/MaterialsInventoryV2View.tsx')
text = path.read_text(encoding='utf-8')

old_import = "import { MaterialsView } from './MaterialsView';\n"
new_import = "import { MaterialsView } from './MaterialsView';\nimport { SapMaterialFlowV1G2 } from './SapMaterialFlowV1G2';\n"
if old_import not in text:
    raise SystemExit('MaterialsView import anchor missing')
text = text.replace(old_import, new_import, 1)

old_tab = "type Tab = 'requirements' | 'stock';"
new_tab = "type Tab = 'sap' | 'requirements' | 'stock';"
if old_tab not in text:
    raise SystemExit('Tab type anchor missing')
text = text.replace(old_tab, new_tab, 1)

old_state = "const [tab, setTab] = useState<Tab>('requirements');"
new_state = "const [tab, setTab] = useState<Tab>('sap');"
if old_state not in text:
    raise SystemExit('Tab state anchor missing')
text = text.replace(old_state, new_state, 1)

old_description = "Requerimientos ligados a la WBS, stock derivado del ledger, reservas, compras, recepción y consumo."
new_description = "Flujo SAP, requerimientos ligados a la WBS, stock derivado del ledger, compras, recepción y consumo desde PostgreSQL Bridata."
if old_description not in text:
    raise SystemExit('Header description anchor missing')
text = text.replace(old_description, new_description, 1)

old_buttons = """            <div className=\"flex items-center gap-1 rounded-xl bg-slate-50 p-1\">\n              <button onClick={() => setTab('requirements')} className={`rounded-lg px-3 py-2 text-[9px] font-bold ${tab === 'requirements' ? 'bg-white text-green-800 shadow-sm' : 'text-slate-500'}`}>Requerimientos y riesgo</button>\n              <button onClick={() => setTab('stock')} className={`rounded-lg px-3 py-2 text-[9px] font-bold ${tab === 'stock' ? 'bg-white text-green-800 shadow-sm' : 'text-slate-500'}`}>Stock por almacén</button>\n            </div>"""
new_buttons = """            <div className=\"flex items-center gap-1 rounded-xl bg-slate-50 p-1\">\n              <button onClick={() => setTab('sap')} className={`rounded-lg px-3 py-2 text-[9px] font-bold ${tab === 'sap' ? 'bg-white text-green-800 shadow-sm' : 'text-slate-500'}`}>Flujo SAP</button>\n              <button onClick={() => setTab('requirements')} className={`rounded-lg px-3 py-2 text-[9px] font-bold ${tab === 'requirements' ? 'bg-white text-green-800 shadow-sm' : 'text-slate-500'}`}>Requerimientos y riesgo</button>\n              <button onClick={() => setTab('stock')} className={`rounded-lg px-3 py-2 text-[9px] font-bold ${tab === 'stock' ? 'bg-white text-green-800 shadow-sm' : 'text-slate-500'}`}>Stock por almacén</button>\n            </div>"""
if old_buttons not in text:
    raise SystemExit('Tab buttons anchor missing')
text = text.replace(old_buttons, new_buttons, 1)

old_conditional = """          {tab === 'requirements' ? (\n            <div className=\"overflow-x-auto\">"""
new_conditional = """          {tab === 'sap' ? (\n            <SapMaterialFlowV1G2\n              workspaceId={currentWorkspace.id}\n              projectId={projectFilter === 'ALL' ? null : projectFilter}\n            />\n          ) : tab === 'requirements' ? (\n            <div className=\"overflow-x-auto\">"""
if old_conditional not in text:
    raise SystemExit('Tab content anchor missing')
text = text.replace(old_conditional, new_conditional, 1)

path.write_text(text, encoding='utf-8')
Path(__file__).unlink()
print('SAP_MATERIAL_FLOW_V1G2_UI_WIRING_OK')
