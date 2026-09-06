# Discord Game Bot

Discord 봇 - 틱택토(`/tictakto`) 및 키 리딤(`/redeem`) 기능

## 기능

### `/tictakto {상대:@유저}`
- 2명만 버튼 사용 가능
- 플레이어 1: 🫄 (`:pregnant_person:`)
- 플레이어 2: 🫃 (`:pregnant_man:`)
- 3x3 상호작용 버튼 보드
- 3개 연속 시 승자 공지

### `/redeem {키:문자열}`
- `data/cotvkey` → cotv 구매 채널 알림 + DM
- `data/rtkey` → rt 구매 채널 알림 + DM
- `data/usedkey` → 이미 사용된 키
- 키 사용 시 자동으로 `usedkey`로 이동

## 키 파일 관리

GitHub 저장소의 `data/` 폴더에서 키를 관리합니다:

```
data/cotvkey   # cotv 키 (한 줄에 하나)
data/rtkey     # rt 키 (한 줄에 하나)
data/usedkey   # 사용된 키 (자동 추가)
```

예시:
```
ABC123-KEY-001
ABC123-KEY-002
```

## Discord 봇 설정

1. [Discord Developer Portal](https://discord.com/developers/applications) → New Application
2. Bot 탭 → Add Bot → Token 복사
3. OAuth2 → URL Generator:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: Send Messages, Use Slash Commands, Read Message History
4. 생성된 URL로 서버에 초대

## GitHub + Render 배포

### 1. GitHub 저장소 생성
```bash
git init
git add .
git commit -m "Initial commit: Discord game bot"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/discord-game-bot.git
git push -u origin main
```

### 2. GitHub Personal Access Token
- Settings → Developer settings → Personal access tokens
- `repo` 권한 필요 (키 파일 읽기/쓰기)

### 3. Render 배포
1. [Render](https://render.com) → New → Blueprint (render.yaml 사용)
   또는 Web Service → GitHub 연결
2. Environment Variables:
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `GITHUB_TOKEN`
   - `GITHUB_OWNER`
   - `GITHUB_REPO`

### 4. Render 주의사항
- Free plan Web Service는 15분 idle 후 sleep → 봇이 끊길 수 있음
- **권장**: Background Worker로 변경 (항상 실행)
  - Render Dashboard → Service → Settings → Type을 Background Worker로 변경
  - `startCommand`: `npm start`

## 로컬 실행

```bash
cp .env.example .env
# .env 파일 편집
npm install
npm start
```

로컬에서는 GitHub env 없이 `data/` 폴더 파일을 직접 사용합니다.
