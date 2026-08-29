from pathlib import Path

path = Path('apps/api/src/routes/sap-integration-foundation-v1a.ts')
text = path.read_text(encoding='utf-8')

old = """      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {\n        return reply.code(400).send({ error: 'integration_import_binary_required' });\n      }\n      if (request.body.length > config.INTEGRATION_MAX_FILE_BYTES) {\n        return reply.code(413).send({ error: 'integration_import_too_large', maxBytes: config.INTEGRATION_MAX_FILE_BYTES });\n      }\n\n      const fileName = safeOriginalFileName(headerValue(request.headers['x-bridata-file-name']));\n"""
new = """      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {\n        return reply.code(400).send({ error: 'integration_import_binary_required' });\n      }\n      const binaryContent = request.body;\n      if (binaryContent.length > config.INTEGRATION_MAX_FILE_BYTES) {\n        return reply.code(413).send({ error: 'integration_import_too_large', maxBytes: config.INTEGRATION_MAX_FILE_BYTES });\n      }\n\n      const fileName = safeOriginalFileName(headerValue(request.headers['x-bridata-file-name']));\n"""
if text.count(old) != 1:
    raise SystemExit(f'PATCH_FAIL buffer narrowing: expected 1 occurrence, got {text.count(old)}')
text = text.replace(old, new)

replacements = [
    ("createHash('sha256').update(request.body).digest('hex')", "createHash('sha256').update(binaryContent).digest('hex')"),
    ("content: request.body,", "content: binaryContent,"),
    ("${BigInt(request.body.length)}", "${BigInt(binaryContent.length)}"),
    ("fileSize: request.body.length,", "fileSize: binaryContent.length,"),
]
for old_value, new_value in replacements:
    count = text.count(old_value)
    if count != 1:
        raise SystemExit(f'PATCH_FAIL {old_value}: expected 1 occurrence, got {count}')
    text = text.replace(old_value, new_value)

path.write_text(text, encoding='utf-8')
Path(__file__).unlink()
print('SAP_INTEGRATION_FOUNDATION_V1A_TYPECHECK_FIX_OK')
