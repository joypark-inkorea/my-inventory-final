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

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();

document.addEventListener('DOMContentLoaded', () => {
    const loginButton = document.getElementById('loginButton');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const errorElement = document.getElementById('login-error');

    loginButton.addEventListener('click', () => {
      const email = emailInput.value;
      const password = passwordInput.value;
      if(errorElement) errorElement.textContent = '';
      if (!email || !password) {
          if(errorElement) errorElement.textContent = '이메일과 비밀번호를 모두 입력하세요.';
          return;
      }
      auth.signInWithEmailAndPassword(email, password)
        .then(() => { window.location.href = 'index.html'; })
        .catch((error) => {
          if(errorElement) {
            if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                errorElement.textContent = '이메일 또는 비밀번호가 잘못되었습니다.';
            } else {
                errorElement.textContent = '로그인 중 오류가 발생했습니다.';
            }
          }
        });
    });
});
