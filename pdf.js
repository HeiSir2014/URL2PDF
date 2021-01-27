var main = angular.module('print', ['directives','services','filters']);
main.controller('printMain', [
	'$rootScope',
	'$scope',
	'$filter',
	'getQuery',
	'Url',
	'updateNewestData',
	function ($rootScope, $scope, $filter, getQuery, Url, updateNewestData) {

		$scope.consultation = {};
		
		//获取链接的参数 
        $scope.stateid = getQuery.getQueryString('id');
        $scope.requisitionid = getQuery.getQueryString('req');
        $scope.userid = getQuery.getQueryString('pk');
        $scope.consultation.patientid = getQuery.getQueryString('pid');
        $scope.showPrintHtml = getQuery.getQueryString('key');
       
		$scope.consultationData = function () {
    		$scope.sData = {
    			requisitionid : $scope.requisitionid,
    			userid: $scope.userid
			};
            $.post(Url.reportPrint, $scope.sData, function (json) {
				$scope.consultation.extraList = json;
				$scope.baseInfoData();
				$scope.$apply();
    		 });
    		
    	};

    	$scope.baseInfoData = function () {
	        $scope.sendData = {
				requisitionid : $scope.requisitionid,
				stateid : $scope.stateid,
				userid: $scope.userid
			};

			$.post(Url.reportQuery, $scope.sendData, function (json) {
				
               $scope.reportItem = json;
			   $scope.$apply();
			   
			   try {
				   
					const {ipcRenderer} = require('electron')
					ipcRenderer.send('pdf-render-finish')
			   } catch (error) {
			   }
			});

	    };
        
    	$scope.consultationData();
       

	}
]);