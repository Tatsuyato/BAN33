
# MAX 33 Comment Manager

<div align="center">

[![English](https://img.shields.io/badge/lang-English-blue?style=for-the-badge&logo=github)](README.en.md)
[![ภาษาไทย](https://img.shields.io/badge/lang-ภาษาไทย-brightgreen?style=for-the-badge&logo=github)](README.th.md)

</div>


# MAX 33 Comment Manager

เครื่องมือง่ายๆ สำหรับจัดการและตรวจสอบคอมเมนต์บน YouTube ออกแบบมาเพื่อตรวจจับและจัดการคอมเมนต์สแปม "MAX 33" โดยเฉพาะ เพียงรันไฟล์ `Run.exe` เตรียม Google API Key และ YouTube Channel ID แล้วเริ่มใช้งานได้เลย!

## การเปลี่ยนแปลงเทคโนโลยี

โปรเจ็กต์นี้เริ่มต้นด้วยการพัฒนาบน `bun.js` แต่เนื่องจากปัญหาความเข้ากันไม่ได้กับ API ที่ใช้งาน จึงได้เปลี่ยนมาใช้ `ts-node` แทนในระหว่างการพัฒนา เพื่อให้สามารถรัน TypeScript ได้
### การรันโปรเจ็กต์ด้วย ts-node
1. ไปที่โฟลเดอร์โปรเจ็กต์:
  ```bash
  cd /path/to/project
  ```
2. รันไฟล์ TypeScript หลัก:
  ```bash
  ts-node src/index.ts
  ```

### หมายเหตุ
- การเปลี่ยนกลับไปใช้ `bun.js` จะพิจารณาอีกครั้งเมื่อ API ที่ใช้งานสามารถรองรับได้อย่างสมบูรณ์
- หากพบปัญหาใดๆ ในการใช้งาน `ts-node` โปรดตรวจสอบเวอร์ชันของ Node.js และ TypeScript ให้เป็นปัจจุบัน

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Tatsuyato/BAN33&type=Date)](https://www.star-history.com/#Tatsuyato/BAN33&Date)

## คุณสมบัติ
- ตรวจสอบคอมเมนต์บนช่อง YouTube ของคุณ
- ตรวจจับคอมเมนต์ที่ซ้ำกัน (เช่น "MAX 33") และระบุว่าเป็นสแปม
- มีแดชบอร์ดสำหรับแอดมินเพื่อดูสถิติสแปม
- ตั้งค่าง่ายด้วยอินเทอร์เฟซที่ใช้งานสะดวก

## สิ่งที่ต้องเตรียม
ก่อนรันแอปพลิเคชัน ตรวจสอบว่าคุณมี:
1. **Google API Key** ที่เปิดใช้งาน YouTube Data API v3 แล้ว
2. **YouTube Channel ID** ของช่องที่ต้องการตรวจสอบ

## ขั้นตอนการตั้งค่า

### ขั้นตอนที่ 1: เปิดใช้งาน YouTube Data API
1. ไปที่ [Google Cloud Console](https://console.cloud.google.com/apis/library/youtube.googleapis.com)
2. ค้นหา "YouTube Data API v3" ใน API Library
3. คลิก "Enable" เพื่อเปิดใช้งาน API สำหรับโปรเจ็กต์ของคุณ (*หมายเหตุ: ต้องเปิดใช้งาน API นี้ด้วยตัวเองที่ https://console.cloud.google.com/apis/library/youtube.googleapis.com*)

### ขั้นตอนที่ 2: รับ Google API Key
1. ใน Google Cloud Console ไปที่ **APIs & Services > Credentials**
2. คลิก **Create Credentials** และเลือก **API Key**
3. คัดลอก API Key ที่สร้างขึ้นมาและบันทึกไว้สำหรับใช้งาน

### ขั้นตอนที่ 3: หา YouTube Channel ID
1. ไปที่ช่อง YouTube ของคุณ
2. ดูโค้ดของหน้า (คลิกขวา > View Page Source) หรือดูจาก URL
3. มองหา `channelId` หรือคัดลอก ID จาก URL (เช่น `UCxxxxxxxxxxxxxxxxxxxxxx`)

### ขั้นตอนที่ 4: รันแอปพลิเคชัน
1. ดาวน์โหลดและแตกไฟล์โปรเจ็กต์
2. รันไฟล์ `Run.exe`
3. ในหน้าตั้งค่าที่ปรากฏขึ้น:
   - กรอก **Google API Key**
   - กรอก **YouTube Channel ID**
   - (可选) ตั้งเวลาการตรวจสอบ (วัน ชั่วโมง นาที) หรือปล่อยเป็น `*` เพื่อตรวจสอบต่อเนื่อง
   - คลิก **บันทึกการตั้งค่า**

## การใช้งาน
- หลังจากตั้งค่า แอปพลิเคชันจะเริ่มตรวจสอบคอมเมนต์ในช่องของคุณ
- เข้าไปที่แดชบอร์ดแอดมินที่ `http://localhost:3000` (หรือพอร์ตที่กำหนด) เพื่อดู:
  - จำนวนคอมเมนต์ทั้งหมด
  - จำนวนคอมเมนต์สแปม (เช่น "MAX 33" ที่ซ้ำกัน)
  - เปอร์เซ็นต์สแปม
  - จำนวนผู้ใช้ที่โพสต์สแปม
- คอมเมนต์ที่ถูกระบุว่าเป็นสแปมจะถูกไฮไลต์เพื่อให้ตรวจสอบได้ง่าย

## หมายเหตุ
- แอปพลิเคชันจะถือว่าคอมเมนต์ที่ซ้ำกัน (ID และข้อความเหมือนกัน) เป็นสแปม
- ตรวจสอบว่า API Key ของคุณมีสิทธิ์และโควต้าสำหรับการใช้ YouTube Data API
- หากต้องการตรวจสอบต่อเนื่อง ให้ใช้ `*` ในช่องตั้งเวลา

## การแก้ปัญหา
- **หน้าการตั้งค่าปรากฏขึ้นซ้ำ?** ตรวจสอบว่า API Key และ Channel ID ถูกต้องและบันทึกเรียบร้อยแล้ว
- **ไม่เห็นคอมเมนต์?** ตรวจสอบ Channel ID และยืนยันว่า API Key สามารถเข้าถึง YouTube Data API ได้

## สัญญาอนุญาต
โปรเจ็กต์นี้อยู่ภายใต้สัญญาอนุญาต MIT - ดูรายละเอียดได้ที่ไฟล์ [LICENSE](LICENSE)

## การมีส่วนร่วม
ยินดีรับข้อเสนอแนะหรือคำขอแก้ไขเพื่อพัฒนาเครื่องมือนี้!