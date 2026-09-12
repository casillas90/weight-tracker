/**
 * Google Apps Script - 체중 기록 & 분석 대시보드 실시간 연동 백엔드
 * 
 * [설정 방법 (1분 완료)]
 * 1. 구글 스프레드시트 새 문서 열기 (예: "내 몸무게 일기")
 * 2. 상단 메뉴 [확장 프로그램] -> [Apps Script] 클릭
 * 3. 기존 코드를 모두 지우고 이 스크립트 전체를 복사하여 붙여넣기
 * 4. 오른쪽 위 [배포] -> [새 배포] 클릭
 * 5. 톱니바퀴 아이콘 -> [웹 앱] 선택
 *    - 설명: "Weight Tracker API"
 *    - 다음 사용자로 실행: "나(My Google Account)"
 *    - 액세스 권한이 있는 사용자: "모든 사용자(Anyone)"  <-- 매우 중요!
 * 6. [배포] 버튼 클릭 후 생성된 [웹 앱 URL] 복사
 * 7. 몸무게 대시보드의 [외부 접속 & 동기화] 탭에 붙여넣기만 하면 실시간 동기화 완료!
 */

function doPost(e) {
  try {
    var rawData = e.postData.contents;
    var data = JSON.parse(rawData);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. 체중 기록 시트 준비
    var sheet = ss.getSheetByName("체중기록");
    if (!sheet) {
      sheet = ss.insertSheet("체중기록");
      sheet.appendRow(["날짜", "시간", "체중(kg)", "체지방률(%)", "골격근량(kg)", "측정구분", "메모", "동기화시각"]);
      sheet.getRange(1, 1, 1, 8).setBackground("#10b981").setFontColor("#ffffff").setFontWeight("bold");
      sheet.setFrozenRows(1);
    }

    // 2. 항목 저장 또는 전체 동기화
    if (data.action === "sync" && data.entries && data.entries.length > 0) {
      // 기존 데이터 읽기 (중복 방지)
      var existingData = sheet.getDataRange().getValues();
      var dateRowMap = {};
      for (var r = 1; r < existingData.length; r++) {
        var rowDate = Utilities.formatDate(new Date(existingData[r][0]), Session.getScriptTimeZone(), "yyyy-MM-dd");
        dateRowMap[rowDate] = r + 1; // 1-based row index
      }

      var nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

      // Sort entries chronological
      var entries = data.entries.sort(function(a, b) {
        return new Date(a.date) - new Date(b.date);
      });

      entries.forEach(function(item) {
        var rowValues = [
          item.date,
          item.time || "",
          item.weight,
          item.bodyFat || "",
          item.muscleMass || "",
          item.timeOfDay === "evening" ? "저녁" : "아침 공복",
          item.note || "",
          nowStr
        ];

        if (dateRowMap[item.date]) {
          // Update existing row
          sheet.getRange(dateRowMap[item.date], 1, 1, 8).setValues([rowValues]);
        } else {
          // Append new row
          sheet.appendRow(rowValues);
          dateRowMap[item.date] = sheet.getLastRow();
        }
      });
    }

    // 3. 사용자 프로필 저장
    if (data.profile) {
      var profileSheet = ss.getSheetByName("사용자설정");
      if (!profileSheet) {
        profileSheet = ss.insertSheet("사용자설정");
        profileSheet.appendRow(["설정 항목", "값"]);
        profileSheet.getRange(1, 1, 1, 2).setBackground("#374151").setFontColor("#ffffff").setFontWeight("bold");
      }
      profileSheet.getRange(2, 1, 5, 2).setValues([
        ["신장(cm)", data.profile.height || 175],
        ["시작체중(kg)", data.profile.initialWeight || 75],
        ["목표체중(kg)", data.profile.targetWeight || 68],
        ["목표달성일", data.profile.targetDate || "2026-12-31"],
        ["성별", data.profile.gender || "male"]
      ]);
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "구글 시트에 " + (data.entries ? data.entries.length : 0) + "개의 기록이 완벽히 동기화되었습니다!",
      syncedAt: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("체중기록");
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        entries: []
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var values = sheet.getDataRange().getValues();
    var entries = [];

    for (var r = 1; r < values.length; r++) {
      var dateVal = values[r][0];
      var dateStr = (dateVal instanceof Date)
        ? Utilities.formatDate(dateVal, Session.getScriptTimeZone(), "yyyy-MM-dd")
        : String(dateVal);

      entries.push({
        id: "sheet_" + r,
        date: dateStr,
        time: String(values[r][1] || ""),
        weight: parseFloat(values[r][2]),
        bodyFat: values[r][3] ? parseFloat(values[r][3]) : null,
        muscleMass: values[r][4] ? parseFloat(values[r][4]) : null,
        timeOfDay: values[r][5] === "저녁" ? "evening" : "morning",
        note: String(values[r][6] || "")
      });
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      entries: entries
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
