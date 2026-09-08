const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const EPHEMERAL_FLAG = 1 << 6;

async function sendCallback(interaction, payload) {
  const response = await fetch(
    `${DISCORD_API_BASE_URL}/interactions/${interaction.id}/${interaction.token}/callback`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2_500),
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Discord interaction callback failed (${response.status}): ${detail}`
    );
  }
}

/**
 * discord.js REST 대기열을 거치지 않고 3초 안에 상호작용을 승인합니다.
 */
async function deferEphemeral(interaction) {
  await sendCallback(interaction, {
    type: 5,
    data: { flags: EPHEMERAL_FLAG },
  });
  interaction.deferred = true;
}

async function replyEphemeral(interaction, content) {
  await sendCallback(interaction, {
    type: 4,
    data: {
      content,
      flags: EPHEMERAL_FLAG,
    },
  });
  interaction.replied = true;
}

/**
 * 상호작용에 대한 첫 응답으로 모달(입력 창)을 띄웁니다.
 * @param {import('discord.js').BaseInteraction} interaction
 * @param {object} modalData 모달 payload(data.custom_id, data.title, data.components)
 */
async function showModal(interaction, modalData) {
  await sendCallback(interaction, {
    type: 9,
    data: modalData,
  });
  interaction.replied = true;
}

module.exports = {
  deferEphemeral,
  replyEphemeral,
  showModal,
};
