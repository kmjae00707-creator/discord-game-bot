const { SlashCommandBuilder } = require('discord.js');
const {
  redeemKey,
  getPurchaseChannelId,
  getPurchaseMessage,
  getPurchaseRoleId,
} = require('../utils/githubKeys');

const redeemCommand = {
  data: new SlashCommandBuilder()
    .setName('redeem')
    .setDescription('구매 키를 사용합니다.')
    .addStringOption((option) =>
      option.setName('키').setDescription('사용할 키').setRequired(true)
    ),

  async execute(interaction) {
    const key = interaction.options.getString('키', true);
    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await redeemKey(key);

      if (result.status === 'used') {
        await interaction.editReply({ content: '이미 쓰인 키입니다.' });
        return;
      }

      if (result.status === 'invalid') {
        await interaction.editReply({ content: '유효한 키가 아닙니다.' });
        return;
      }

      const username = interaction.user.username;

      const channelId = getPurchaseChannelId(result.type);
      const channel = await interaction.client.channels.fetch(channelId);

      if (channel?.isTextBased()) {
        await channel.send(getPurchaseMessage(username, result.type));
      }

      if (interaction.inGuild() && interaction.guild) {
        const roleId = getPurchaseRoleId(result.type);
        try {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          await member.roles.add(roleId);
        } catch (roleError) {
          console.error('[redeem] role assign error:', roleError);
          await interaction.editReply({
            content:
              '키는 사용되었지만 역할 지급에 실패했습니다. 관리자에게 문의해 주세요.',
          });
          return;
        }
      }

      try {
        await interaction.user.send('대기열에 추가 되었습니다.');
      } catch {
        await interaction.editReply({
          content:
            '키 사용은 완료되었지만 DM을 보낼 수 없습니다. Discord 설정에서 DM을 허용해 주세요.',
        });
        return;
      }

      await interaction.editReply({ content: '키가 성공적으로 사용되었습니다.' });
    } catch (error) {
      console.error('[redeem] error:', error);
      await interaction.editReply({
        content: '키 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
  },
};

module.exports = { redeemCommand };
