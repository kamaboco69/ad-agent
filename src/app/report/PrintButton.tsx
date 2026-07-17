"use client";

// PDFダウンロード = ブラウザの印刷ダイアログ（A4横・背景色印刷ON推奨）
export function PrintButton() {
  return (
    <div className="no-print toolbar">
      <a href="/" className="tb-link">← ダッシュボードへ戻る</a>
      <button onClick={() => window.print()} className="tb-btn">
        PDFダウンロード（印刷）
      </button>
      <span className="tb-hint">保存先で「PDFに保存」を選択。背景のグラフィックをONにすると配色どおりに出ます。</span>
    </div>
  );
}
