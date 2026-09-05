import { Component, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="fatal-screen"><AlertCircle size={32} /><h1>화면을 다시 준비해야 해요</h1><p>일시적인 오류가 발생했습니다. 원본 파일은 변경되지 않았습니다.<br />새로고침한 뒤 Timeline과 사진을 다시 선택해 주세요.</p><button className="primary-button" type="button" onClick={() => location.reload()}>앱 다시 열기</button></main>;
  }
}
