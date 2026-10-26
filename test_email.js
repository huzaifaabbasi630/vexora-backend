require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { sendEmail } = require('./src/utils/email');

(async () => {
  try {
    await sendEmail(
      process.env.EMAIL_USER,
      'Test email from Vexora',
      null,
      { html: `<h1>Hello!</h1><p>If you see this, your SMTP setup works.</p>` }
    );
    console.log('✅ Test email sent successfully');
  } catch (err) {
    console.error('❌ Failed to send test email', err);
  }
})();
