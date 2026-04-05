require('dotenv').config();
const pool = require('./db');

async function setupDatabase() {
  try {
    await pool.query(`DROP TABLE IF EXISTS documents`);
    await pool.query(`DROP TABLE IF EXISTS students`);

    await pool.query(`
      CREATE TABLE students (
        unique_id                 VARCHAR(20)   PRIMARY KEY,
        full_name                 VARCHAR(255),
        contact_medium1           VARCHAR(50),
        phone_country_code1       VARCHAR(20),
        contact_detail1           VARCHAR(255),
        contact_medium2           VARCHAR(50),
        phone_country_code2       VARCHAR(20),
        contact_detail2           VARCHAR(255),
        email                     VARCHAR(255),
        hidden_phone_country_code VARCHAR(20),
        phone                     VARCHAR(50),
        study_plans               TEXT,
        lead_source               VARCHAR(100),
        interaction               VARCHAR(100),
        destination_country       VARCHAR(255),
        timeline                  VARCHAR(100),
        process_application       VARCHAR(50),
        residency                 VARCHAR(100),
        year_of_birth             VARCHAR(10),
        preferred_social          VARCHAR(50),
        social_consent            VARCHAR(50),
        school_event              VARCHAR(255),
        budget                    VARCHAR(100),
        scholarship_demand        VARCHAR(50),
        english_level             VARCHAR(50),
        gpa                       VARCHAR(20),
        immigration_history       TEXT,
        sponsor_income            VARCHAR(100),
        income_evidence           VARCHAR(100),
        study_plan_gap            TEXT,
        ultimate_objective        TEXT,
        risk_score                VARCHAR(20),
        stone_tier                VARCHAR(50),
        headshot_url              TEXT,
        qr_code_image_url         TEXT,
        mother_email              VARCHAR(255),
        mother_full_name          VARCHAR(255),
        mother_phone_country_code VARCHAR(20),
        mother_phone              VARCHAR(50),
        mother_contact_medium     VARCHAR(50),
        mother_contact_cc         VARCHAR(20),
        mother_contact_detail     VARCHAR(255),
        father_email              VARCHAR(255),
        father_full_name          VARCHAR(255),
        father_phone_country_code VARCHAR(20),
        father_phone              VARCHAR(50),
        father_contact_medium     VARCHAR(50),
        father_contact_cc         VARCHAR(20),
        father_contact_detail     VARCHAR(255),
        counseling_notes          TEXT,
        case_officer_notes        TEXT,
        management_notes          TEXT,
        created_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status                    VARCHAR(20) DEFAULT 'Active'
      );
    `);

    await pool.query(`
      CREATE TABLE documents (
        document_id   VARCHAR(50)  PRIMARY KEY,
        student_id    VARCHAR(20)  REFERENCES students(unique_id),
        type          VARCHAR(100),
        description   TEXT,
        file_name     VARCHAR(255),
        drive_file_id VARCHAR(255),
        view_url      TEXT,
        timestamp     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✅ Database tables created successfully');
  } catch (err) {
    console.error('❌ Error creating tables:', err);
  } finally {
    await pool.end();
  }
}

setupDatabase();