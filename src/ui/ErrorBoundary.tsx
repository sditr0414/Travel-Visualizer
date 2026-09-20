import { Component, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="fatal-screen"><AlertCircle size={32} /><h1>화면을 불러오지 못했습니다</h1><p>화면을 표시하는 중 오류가 발생했습니다.<br />원본 파일은 변경되지 않았습니다.</p><p>새로고침한 뒤 타임라인과 사진을 다시 선택해 주세요.</p><button className="primary-button" type="button" onClick={() => location.reload()}>새로고침</button></main>;
  }
}
