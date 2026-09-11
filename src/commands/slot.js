const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { deferEphemeral } = require('../utils/interactionResponse');
const { updateSlotGppoint, SLOT_GP_PER_GP } = require('../utils/gppointData');

const SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '💎', '7️⃣'];
const JACKPOT_SYMBOL = '7️⃣';

// 재획득 쿨다운 (기본 2분)
const COOLDOWN_MS = Number(process.env.SLOT_COOLDOWN_MS) || 2 * 60 * 1000;

/** @type {Map<string, number>} userId -> 마지막 플레이 시각 */
const lastPlayed = new Map();

function spin() {
  return Array.from(
    { length: 3 },
    () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]
  );
}

/** 스핀 결과로 보상 slotgppoint와 설명을 계산합니다. */
function evaluate(reels) {
  const [a, b, c] = reels;

  if (a === b && b === c) {
    if (a === JACKPOT_SYMBOL) return { reward: 100, label: '🎉 잭팟! 7️⃣7️⃣7️⃣', color: 0xf1c40f };
    return { reward: 50, label: '✨ 트리플!', color: 0x57f287 };
  }
  if (a === b || b === c || a === c) {
    return { reward: 10, label: '👍 더블!', color: 0x5865f2 };
  }
  return { reward: 2, label: '참가 보상', color: 0x99aab5 };
}

function formatRemaining(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}초`;
  return `${minutes}분 ${seconds}초`;
}

const slotCommand = {
  data: new SlashCommandBuilder()
    .setName('slot')
    .setDescription(`슬롯머신을 돌려 slotgppoint를 획득합니다. (${SLOT_GP_PER_GP} slotgp = 1 gp)`)
    .setDMPermission(false),

  async execute(interaction) {
    await deferEphemeral(interaction);

    const userId = interaction.user.id;
    const now = Date.now();
    const last = lastPlayed.get(userId) || 0;
    const elapsed = now - last;

    if (elapsed < COOLDOWN_MS) {
      await interaction.editReply({
        content: `아직 쿨다운 중입니다. **${formatRemaining(
          COOLDOWN_MS - elapsed
        )}** 후에 다시 시도해 주세요.`,
      });
      return;
    }

    lastPlayed.set(userId, now);

    try {
      const reels = spin();
      const { reward, label, color } = evaluate(reels);
      const { amount } = await updateSlotGppoint(userId, 'add', reward);

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle('🎰 슬롯머신')
        .setDescription(
          [
            `**[ ${reels.join(' | ')} ]**`,
            label,
            `획득: **+${reward} slotgppoint**`,
            `현재 slotgppoint: **${amount.toLocaleString()} slotgp**`,
            `환전: **${SLOT_GP_PER_GP} slotgp = 1 gppoint** (대시보드 GP환전)`,
          ].join('\n')
        );

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('[slot] error:', error);
      lastPlayed.delete(userId);
      await interaction.editReply({
        content: '슬롯 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
  },
};

module.exports = { slotCommand };
