// 🔥 중요: 이 곳에 본인의 Firebase 프로젝트 설정 키를 붙여넣으세요.
const firebaseConfig = {
 apiKey: "AIzaSyDA0BNmhnr37KqyI7oj766TwB8FrejsRzo",
  authDomain: "my-inventory-final.firebaseapp.com",
  projectId: "my-inventory-final",
  storageBucket: "my-inventory-final.firebasestorage.app",
  messagingSenderId: "740246970535",
  appId: "1:740246970535:web:f7738b92a6097671f67b82",
  measurementId: "G-4ZF63VWX6Z"
};

console.log("진단 스크립트: 시작 (1/7)");

try {
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
        console.log("진단 스크립트: Firebase 초기화 성공 (2/7)");
    }
    const auth = firebase.auth();
    const db = firebase.firestore();
    console.log("진단 스크립트: Auth 및 DB 서비스 가져오기 성공 (3/7)");

    auth.onAuthStateChanged(user => {
        console.log("진단 스크립트: 로그인 상태 확인 시작 (4/7)");
        const loader = document.getElementById('loader');
        const appContent = document.getElementById('app-content');

        if (user) {
            console.log("진단 스크립트: 사용자 찾음! UID:", user.uid, "(5/7)");
            if(loader) loader.style.display = 'none';
            if(appContent) appContent.style.display = 'block';
            
            // 로그아웃 버튼에 이벤트 연결
            const logoutButton = document.getElementById('logout-button');
            if(logoutButton) {
                logoutButton.addEventListener('click', () => {
                    auth.signOut().catch(error => console.error("로그아웃 오류:", error));
                });
                console.log("진단 스크립트: 로그아웃 버튼 연결 성공 (6/7)");
            } else {
                 console.error("진단 스크립트: 로그아웃 버튼을 찾을 수 없음!");
            }
            
            alert("진단 준비 완료! 이 경고창을 닫고 개발자 도구의 Console 내용을 복사해주세요.");
            console.log("진단 스크립트: 모든 진단 준비 완료 (7/7)");

        } else {
            console.log("진단 스크립트: 사용자 없음. 로그인 페이지로 이동합니다.");
            window.location.href = 'login.html';
        }
    });
} catch (error) {
    console.error("진단 스크립트: Firebase 초기화 중 치명적 오류 발생!", error);
    alert("Firebase 초기화 중 오류가 발생했습니다. 개발자 도구의 Console 내용을 확인해주세요.");
}

