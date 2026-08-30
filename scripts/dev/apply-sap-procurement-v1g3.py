from pathlib import Path

app_path = Path('src/App.tsx')
sidebar_path = Path('src/components/layout/Sidebar.tsx')
self_path = Path(__file__)

app = app_path.read_text()
sidebar = sidebar_path.read_text()

app_import_anchor = "import { SapIntegrationCenterV1G1View } from './components/views/SapIntegrationCenterV1G1View';\n"
app_import = app_import_anchor + "import { SapProcurementV1G3View } from './components/views/SapProcurementV1G3View';\n"
if "SapProcurementV1G3View" not in app:
    if app_import_anchor not in app:
        raise SystemExit('App import anchor missing')
    app = app.replace(app_import_anchor, app_import, 1)

case_anchor = "    case 'materials': return <MaterialsInventoryV2View />;\n"
case_with_procurement = case_anchor + "    case 'procurement': return <SapProcurementV1G3View />;\n"
if "case 'procurement'" not in app:
    if case_anchor not in app:
        raise SystemExit('App materials route anchor missing')
    app = app.replace(case_anchor, case_with_procurement, 1)

icon_anchor = "  PackageSearch,\n"
if "  ShoppingCart,\n" not in sidebar:
    if icon_anchor not in sidebar:
        raise SystemExit('Sidebar icon anchor missing')
    sidebar = sidebar.replace(icon_anchor, icon_anchor + "  ShoppingCart,\n", 1)

menu_anchor = "    { id: 'materials', label: 'Materiales', icon: PackageSearch },\n"
menu_with_procurement = menu_anchor + "    { id: 'procurement', label: 'Compras / Por llegar', icon: ShoppingCart },\n"
if "id: 'procurement'" not in sidebar:
    if menu_anchor not in sidebar:
        raise SystemExit('Sidebar materials anchor missing')
    sidebar = sidebar.replace(menu_anchor, menu_with_procurement, 1)

app_path.write_text(app)
sidebar_path.write_text(sidebar)
self_path.unlink()
print('SAP_PROCUREMENT_V1G3_WIRING_OK')
