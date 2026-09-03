from pathlib import Path

app_path = Path('src/App.tsx')
app = app_path.read_text()
old = 'aria-label="날짜 표시 시간" type="range" min="1" max="3.5" step="0.2"'
new = 'aria-label="날짜 표시 시간" type="range" min="1" max="5" step="0.2"'
if old not in app:
    raise SystemExit('day marker slider marker missing')
app_path.write_text(app.replace(old, new, 1))

test_path = Path('src/App.test.tsx')
test = test_path.read_text()
old_test = "expect(screen.getByRole('slider', { name: '날짜 표시 시간' })).toHaveValue('1.8');"
new_test = "expect(screen.getByRole('slider', { name: '날짜 표시 시간' })).toHaveValue('1.8');\n    expect(screen.getByRole('slider', { name: '날짜 표시 시간' })).toHaveAttribute('min', '1');\n    expect(screen.getByRole('slider', { name: '날짜 표시 시간' })).toHaveAttribute('max', '5');"
if old_test not in test:
    raise SystemExit('day marker test marker missing')
test_path.write_text(test.replace(old_test, new_test, 1))
