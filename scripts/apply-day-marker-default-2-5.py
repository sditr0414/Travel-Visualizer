from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing marker: {label}')
    return text.replace(old, new, 1)

app_path = Path('src/App.tsx')
app = app_path.read_text()
app = replace_once(app, "const [dayMarkerSec, setDayMarkerSec] = useState(1.8);", "const [dayMarkerSec, setDayMarkerSec] = useState(2.5);", 'day marker default')
app = replace_once(app, 'aria-label="날짜 표시 시간" type="range" min="1" max="5" step="0.2"', 'aria-label="날짜 표시 시간" type="range" min="1" max="5" step="0.5"', 'day marker step')
app_path.write_text(app)

test_path = Path('src/App.test.tsx')
test = test_path.read_text()
test = replace_once(test, "toHaveAttribute('max', '5.8')", "toHaveAttribute('max', '6.5')", 'photo journey duration expectation')
test = replace_once(test, "expect(screen.getByRole('slider', { name: '날짜 표시 시간' })).toHaveValue('1.8');", "expect(screen.getByRole('slider', { name: '날짜 표시 시간' })).toHaveValue('2.5');", 'day marker default test')
test = replace_once(test, "expect(screen.getByRole('slider', { name: '날짜 표시 시간' })).toHaveAttribute('max', '5');", "expect(screen.getByRole('slider', { name: '날짜 표시 시간' })).toHaveAttribute('max', '5');\n    expect(screen.getByRole('slider', { name: '날짜 표시 시간' })).toHaveAttribute('step', '0.5');", 'day marker step test')
test_path.write_text(test)
