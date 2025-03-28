const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendEmail = async (mailOptions) => {
  try {
    console.log("Attempting to send email to:", mailOptions.to);
    console.log("Email subject:", mailOptions.subject);

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", {
      messageId: info.messageId,
      response: info.response,
    });
    return info;
  } catch (error) {
    console.error("Error sending email:", {
      error: error.message,
      stack: error.stack,
      code: error.code,
      command: error.command,
    });
    throw error;
  }
};

const sendAppointmentConfirmation = async (appointment) => {
  console.log(
    "Preparing appointment confirmation email for:",
    appointment.patient_email
  );

  const mailOptions = {
    from: process.env.SMTP_USER,
    to: appointment.patient_email,
    subject: "Appointment Request Confirmation",
    html: `
            <h2>Appointment Request Confirmation</h2>
            <p>Dear ${appointment.patient_name},</p>
            <p>Your appointment request has been submitted successfully. Here are the details:</p>
            <ul>
                <li>Doctor: ${appointment.doctor_name}</li>
                <li>Date: ${appointment.appointment_date}</li>
                <li>Time: ${appointment.start_time} - ${appointment.end_time}</li>
                <li>Consultation Type: ${appointment.consultation_type}</li>
            </ul>
            <p>Your request is pending approval from our admin team. You will receive another email once your appointment is approved.</p>
            <p>If you need to make any changes to your request, please contact us immediately.</p>
            <p>Best regards,<br>MedCare Team</p>
        `,
  };

  return sendEmail(mailOptions);
};

module.exports = {
  sendAppointmentConfirmation,
};
