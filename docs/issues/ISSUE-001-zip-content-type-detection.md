# ISSUE-001: Claude 내보내기 URL fetch 시 HTML 응답을 zip으로 오인

## 이슈 요약
Claude 내보내기 URL을 `fetch()`로 직접 요청하면 HTTP 200 OK로 응답하지만,
본문이 바이너리 zip이 아닌 HTML(로그인 리디렉션 페이지)이어서 AdmZip 파싱 실패.

## 재현 조건
- `data/manifest.json`의 `export_url`을 Node.js `fetch()`로 직접 요청
- Claude 세션 쿠키 없이 요청하는 경우 (CLI 환경에서 항상 해당)
- 응답 HTTP 상태는 200이지만 Content-Type이 `text/html`

## 원인 분석
Claude 내보내기 URL은 브라우저 세션 인증(쿠키)이 필요한 일회성 링크.
Node.js `fetch()`는 브라우저 세션 쿠키를 갖고 있지 않아 로그인 페이지로 리디렉션됨.
HTTP 상태코드만으로는 성공/실패를 판단할 수 없고, Content-Type 헤더를 확인해야 함.

## 적용한 해결책
`src/downloader.ts`에서 Content-Type 헤더 검사 후 분기:

```typescript
const contentType = response.headers.get('content-type') ?? '';
const isZip = response.ok && (
  contentType.includes('zip') ||
  contentType.includes('octet-stream') ||
  contentType.includes('binary')
);

if (isZip) {
  zipBuffer = Buffer.from(await response.arrayBuffer());
} else {
  // 브라우저 자동 열기 + ~/Downloads 폴더 감시
  execSync(openCmd);
  const zipPath = await waitForDownload(downloadsDir, before);
  zipBuffer = fs.readFileSync(zipPath);
}
```

## 개선 방안
1. **응답 본문 앞부분 확인**: Content-Type이 없거나 애매한 경우 응답 바이트 앞 4바이트(`PK\x03\x04`)로 zip 매직 넘버 확인
2. **다운로드 폴더 감시 타임아웃 UI 개선**: 현재 2분 대기 중 진행상황이 없음. 10초마다 경과 시간 출력 필요
3. **Chrome/Safari 쿠키 추출 자동화 검토**: `keychain` 또는 브라우저 프로파일에서 쿠키를 읽어 fetch에 포함하는 방식 (보안 리스크 있어 신중 검토 필요)
4. **만료된 링크 감지**: HTML 응답 본문에 "expired" 또는 "만료" 키워드가 있으면 별도 에러 메시지 출력

## 적용한 해결책
- zip 매직 넘버(`PK\x03\x04`) 검증으로 Content-Type 오판 방지
- 만료된 링크 감지 시 명확한 에러 메시지 출력
- 다운로드 대기 중 10초 단위 진행 상황 출력
